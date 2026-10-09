import { Msg } from '../../domain/types';
import { hasAnyCue } from '../rules/cues';
import { parseMessageDate } from '../rules/dates';

export const CONTEXT_LOOKBACK_LIMIT = 300;
export const WINDOW_MESSAGE_TARGET = 30;
export const WINDOW_TOKEN_TARGET = 1500;
export const WINDOW_OVERLAP_MESSAGES = 4;
export const DEFAULT_MAX_WINDOWS = 12;

export type ChatWindow = {
  index: number;
  messages: Msg[];
  formattedText: string;
  estimatedTokens: number;
};

export type ChunkingResult = {
  scopedMessages: Msg[];
  unreadMessages: Msg[];
  contextMessages: Msg[];
  filteredMessages: Msg[];
  windows: ChatWindow[];
  cappedWindows: ChatWindow[];
  hasMoreWindows: boolean;
  totalUncappedWindows: number;
};

const EMOJI_OR_PUNCT_ONLY_RE = /^[\p{Extended_Pictographic}\p{Emoji_Presentation}\p{P}\p{S}\s]+$/u;
const TRIVIAL_ACK_RE =
  /^(?:ok+|okay+|k+|kk+|yes|yep|yup|yeah|no|nope|nah|thanks|thank you|thx|ty|cool|nice|great|good|acha|accha|theek|thik|thik hai|theek hai|sahi|hmm+|hm+|lol|lmao|haha+|hehe+|👍+|🙏+|👌+|✅+)$/i;

export function isNoiseMessage(msg: Msg): boolean {
  if (msg.isSystem) return true;
  const trimmed = msg.text.trim();
  if (!trimmed) return true;

  if (/^<media omitted>$/i.test(trimmed) || /^this message was deleted\.?$/i.test(trimmed)) {
    return true;
  }

  if (EMOJI_OR_PUNCT_ONLY_RE.test(trimmed)) {
    return true;
  }

  // Very short replies without cues or dates
  const wordCount = trimmed.split(/\s+/).length;
  if (wordCount <= 2 && trimmed.length <= 14) {
    if (TRIVIAL_ACK_RE.test(trimmed)) {
      return true;
    }
    const hasCue = hasAnyCue(trimmed);
    const hasDate = parseMessageDate(trimmed, msg.ts) !== undefined;
    if (!hasCue && !hasDate && !trimmed.includes('@')) {
      return true;
    }
  }

  return false;
}

export function formatWindowLine(msg: Msg): string {
  const flatText = msg.text.replace(/\r?\n/g, ' ').trim();
  return `[#${msg.id}] ${msg.sender}: ${flatText}`;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function buildScopedWindows(
  allMessages: Msg[],
  lastReadTs: number,
  maxWindows: number = DEFAULT_MAX_WINDOWS
): ChunkingResult {
  // Split into earlier vs unread (ts >= lastReadTs)
  const earlier: Msg[] = [];
  const unread: Msg[] = [];

  for (const m of allMessages) {
    if (m.ts >= lastReadTs) {
      unread.push(m);
    } else {
      earlier.push(m);
    }
  }

  // Up to 300 earlier messages as context
  const contextMessages = earlier.slice(Math.max(0, earlier.length - CONTEXT_LOOKBACK_LIMIT));
  const scopedMessages = [...contextMessages, ...unread];

  // Drop noise first
  const filteredMessages = scopedMessages.filter((m) => !isNoiseMessage(m));

  // Build chronological windows of ~30 messages or ~1500 tokens with 4-message overlap
  const chronologicalWindows: ChatWindow[] = [];
  let startIdx = 0;

  while (startIdx < filteredMessages.length) {
    const winMsgs: Msg[] = [];
    const lines: string[] = [];
    let tokenCount = 0;
    let i = startIdx;

    while (i < filteredMessages.length) {
      const msg = filteredMessages[i];
      const line = formatWindowLine(msg);
      const lineTokens = estimateTokens(line) + 1;

      if (
        winMsgs.length > 0 &&
        (winMsgs.length >= WINDOW_MESSAGE_TARGET || tokenCount + lineTokens > WINDOW_TOKEN_TARGET)
      ) {
        break;
      }

      winMsgs.push(msg);
      lines.push(line);
      tokenCount += lineTokens;
      i++;
    }

    chronologicalWindows.push({
      index: chronologicalWindows.length,
      messages: winMsgs,
      formattedText: lines.join('\n'),
      estimatedTokens: tokenCount,
    });

    if (i >= filteredMessages.length) {
      break;
    }

    // Advance with 4-message overlap, ensuring forward progress of at least 1 message
    const step = Math.max(1, winMsgs.length - WINDOW_OVERLAP_MESSAGES);
    startIdx += step;
  }

  // Process newest windows first
  const newestFirst = [...chronologicalWindows].reverse().map((w, idx) => ({
    ...w,
    index: idx,
  }));

  const cappedWindows = newestFirst.slice(0, maxWindows);

  return {
    scopedMessages,
    unreadMessages: unread,
    contextMessages,
    filteredMessages,
    windows: newestFirst,
    cappedWindows,
    hasMoreWindows: newestFirst.length > maxWindows,
    totalUncappedWindows: newestFirst.length,
  };
}
