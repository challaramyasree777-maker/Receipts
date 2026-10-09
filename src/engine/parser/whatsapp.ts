import { Msg } from '../../domain/types';

export const MAX_CHAT_FILE_BYTES = 20 * 1024 * 1024; // 20 MB

export type ParseResult = {
  messages: Msg[];
  senders: string[];
  dateOrder: 'dmy' | 'mdy';
};

export class WhatsAppParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WhatsAppParseError';
  }
}

// Android format: "dd/mm/yy, h:mm am - Sender: text" or "dd/mm/yyyy, hh:mm - system message"
// Also supports "." or "-" date separators occasionally exported by regional locales
const ANDROID_LINE_RE =
  /^(\d{1,2})[\/\.-](\d{1,2})[\/\.-](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([ap]\.?m\.?))?\s+-\s+(.*)$/i;

// iOS format: "[dd/mm/yy, hh:mm:ss] Sender: text" or "[dd/mm/yyyy, h:mm:ss AM] Sender: text"
const IOS_LINE_RE =
  /^\[(\d{1,2})[\/\.-](\d{1,2})[\/\.-](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([ap]\.?m\.?))?\]\s+(.*)$/i;

const SYSTEM_CONTENT_PATTERNS = [
  /^<media omitted>$/i,
  /^image omitted$/i,
  /^video omitted$/i,
  /^audio omitted$/i,
  /^document omitted$/i,
  /^sticker omitted$/i,
  /^gif omitted$/i,
  /^contact card omitted$/i,
  /^this message was deleted\.?$/i,
  /^you deleted this message\.?$/i,
  /^messages and calls are end-to-end encrypted/i,
  /^missed voice call$/i,
  /^missed video call$/i,
];

const SYSTEM_ACTION_PATTERNS = [
  /created group/i,
  /added you/i,
  /\badded\b.*\bto the group\b/i,
  /\bleft$/i,
  /changed the subject/i,
  /changed this group's icon/i,
  /changed the group description/i,
  /changed their phone number/i,
  /security code changed/i,
  /turned on disappearing messages/i,
  /pinned a message/i,
];

function sanitizeRawLine(line: string): string {
  // Strip U+200E (Left-to-Right Mark), U+200F (Right-to-Left Mark), U+FEFF (BOM)
  // Convert U+202F (Narrow No-Break Space) and U+00A0 (No-Break Space) to normal space
  return line
    .replace(/[\u200E\u200F\uFEFF]/g, '')
    .replace(/[\u202F\u00A0]/g, ' ');
}

interface RawHeaderMatch {
  p1: number;
  p2: number;
  yearRaw: number;
  hourRaw: number;
  minute: number;
  second: number;
  meridiem?: string;
  rest: string;
  isIos: boolean;
}

function matchLineHeader(sanitizedLine: string): RawHeaderMatch | null {
  const iosMatch = sanitizedLine.match(IOS_LINE_RE);
  if (iosMatch) {
    return {
      p1: parseInt(iosMatch[1], 10),
      p2: parseInt(iosMatch[2], 10),
      yearRaw: parseInt(iosMatch[3], 10),
      hourRaw: parseInt(iosMatch[4], 10),
      minute: parseInt(iosMatch[5], 10),
      second: iosMatch[6] ? parseInt(iosMatch[6], 10) : 0,
      meridiem: iosMatch[7],
      rest: iosMatch[8],
      isIos: true,
    };
  }

  const androidMatch = sanitizedLine.match(ANDROID_LINE_RE);
  if (androidMatch) {
    return {
      p1: parseInt(androidMatch[1], 10),
      p2: parseInt(androidMatch[2], 10),
      yearRaw: parseInt(androidMatch[3], 10),
      hourRaw: parseInt(androidMatch[4], 10),
      minute: parseInt(androidMatch[5], 10),
      second: androidMatch[6] ? parseInt(androidMatch[6], 10) : 0,
      meridiem: androidMatch[7],
      rest: androidMatch[8],
      isIos: false,
    };
  }

  return null;
}

function normalizeYear(y: number): number {
  if (y < 100) {
    return y >= 70 ? 1900 + y : 2000 + y;
  }
  return y;
}

function normalizeHour(hour: number, meridiem?: string): number {
  if (!meridiem) return hour;
  const clean = meridiem.replace(/\./g, '').toLowerCase();
  if (clean === 'pm' && hour < 12) return hour + 12;
  if (clean === 'am' && hour === 12) return 0;
  return hour;
}

function isSpecialSystemText(text: string): boolean {
  const trimmed = text.trim();
  for (const pat of SYSTEM_CONTENT_PATTERNS) {
    if (pat.test(trimmed)) return true;
  }
  return false;
}

export function parseWhatsAppText(rawInput: string, byteLength?: number): ParseResult {
  const size = byteLength ?? new TextEncoder().encode(rawInput).byteLength;
  if (size > MAX_CHAT_FILE_BYTES) {
    throw new WhatsAppParseError(
      'File exceeds the 20 MB limit. Please export the chat without media ("Without media") and try again.'
    );
  }

  if (!rawInput || !rawInput.trim()) {
    throw new WhatsAppParseError(
      'The chat input is empty. Please upload a WhatsApp .txt export or paste exported chat lines.'
    );
  }

  const rawLines = rawInput.replace(/\r\n?/g, '\n').split('\n');

  interface IntermediateEntry {
    header: RawHeaderMatch;
    lines: string[];
  }

  const entries: IntermediateEntry[] = [];

  for (const rawLine of rawLines) {
    const cleanLine = sanitizeRawLine(rawLine);
    if (!cleanLine.trim() && entries.length === 0) {
      continue;
    }

    const header = matchLineHeader(cleanLine);
    if (header) {
      entries.push({
        header,
        lines: [header.rest],
      });
    } else if (entries.length > 0) {
      entries[entries.length - 1].lines.push(cleanLine);
    }
  }

  if (entries.length === 0) {
    throw new WhatsAppParseError(
      'Unrecognized format. Expected a WhatsApp exported text format such as "14/03/25, 9:41 am - Name: Message" (Android) or "[14/03/25, 09:41:12] Name: Message" (iOS).'
    );
  }

  // Detect dd/mm vs mm/dd:
  // "if any first number is greater than 12 it is dd/mm; default dd/mm"
  // If no first number > 12 and at least one second number > 12, it is mm/dd.
  let anyFirstGt12 = false;
  let anySecondGt12 = false;
  for (const entry of entries) {
    if (entry.header.p1 > 12) anyFirstGt12 = true;
    if (entry.header.p2 > 12) anySecondGt12 = true;
  }
  const dateOrder: 'dmy' | 'mdy' = anyFirstGt12
    ? 'dmy'
    : anySecondGt12
      ? 'mdy'
      : 'dmy';

  const messages: Msg[] = [];
  const senderSet = new Set<string>();

  for (let i = 0; i < entries.length; i++) {
    const { header, lines } = entries[i];
    const fullRest = lines.join('\n').trim();

    const day = dateOrder === 'dmy' ? header.p1 : header.p2;
    const month = (dateOrder === 'dmy' ? header.p2 : header.p1) - 1;
    const year = normalizeYear(header.yearRaw);
    const hour = normalizeHour(header.hourRaw, header.meridiem);

    const dateObj = new Date(year, month, day, hour, header.minute, header.second, 0);
    const ts = dateObj.getTime();

    // Check if there is a "Sender: message" split in the first line
    const firstLine = lines[0];
    const colonIdx = firstLine.indexOf(': ');

    let sender = 'System';
    let text = fullRest;
    let isSystem = true;

    if (colonIdx > 0 && colonIdx <= 60) {
      const candidateSender = firstLine.slice(0, colonIdx).trim();
      const firstLineBody = firstLine.slice(colonIdx + 2);
      const bodyLines = [firstLineBody, ...lines.slice(1)];
      const candidateText = bodyLines.join('\n').trim();

      // Verify candidateSender doesn't look like a system action phrase itself
      const looksLikeSystemSender = SYSTEM_ACTION_PATTERNS.some((pat) =>
        pat.test(candidateSender)
      );

      if (!looksLikeSystemSender && candidateSender.length > 0) {
        sender = candidateSender;
        text = candidateText;
        isSystem = isSpecialSystemText(candidateText);
      }
    }

    if (!isSystem && sender !== 'System') {
      senderSet.add(sender);
    }

    messages.push({
      id: i + 1,
      ts,
      sender,
      text,
      isSystem,
    });
  }

  return {
    messages,
    senders: Array.from(senderSet),
    dateOrder,
  };
}
