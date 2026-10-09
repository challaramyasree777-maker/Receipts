import { LedgerItem } from '../../domain/types';

const MIN_VALID_YEAR = 2000;
const MAX_VALID_YEAR = 2100;
const DEFAULT_EVENT_DURATION_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Checks whether an item has a valid, sufficiently unambiguous due date
 * suitable for calendar export (must be an open item with a finite timestamp
 * in a reasonable calendar range).
 */
export function hasValidCalendarDueDate(item: LedgerItem): boolean {
  if (item.status !== 'open') return false;
  if (typeof item.due !== 'number' || !Number.isFinite(item.due) || item.due <= 0) {
    return false;
  }
  const d = new Date(item.due);
  const year = d.getFullYear();
  if (Number.isNaN(year) || year < MIN_VALID_YEAR || year > MAX_VALID_YEAR) {
    return false;
  }
  return true;
}

/**
 * Escapes special characters in ICS text fields according to RFC 5545:
 * backslashes, semicolons, commas, and newlines.
 */
export function escapeIcsText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * Formats a timestamp as a UTC iCalendar date-time string: YYYYMMDDTHHMMSSZ
 */
export function formatIcsUtcDateTime(ts: number): string {
  const d = new Date(ts);
  const pad2 = (n: number) => n.toString().padStart(2, '0');
  return (
    `${d.getUTCFullYear()}` +
    `${pad2(d.getUTCMonth() + 1)}` +
    `${pad2(d.getUTCDate())}T` +
    `${pad2(d.getUTCHours())}` +
    `${pad2(d.getUTCMinutes())}` +
    `${pad2(d.getUTCSeconds())}Z`
  );
}

/**
 * Formats a timestamp as a local date-only string: YYYYMMDD
 */
export function formatIcsDateOnly(ts: number): string {
  const d = new Date(ts);
  const pad2 = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
}

/**
 * Checks if a timestamp sits at midnight (00:00:00), which indicates a date-only
 * expression without a specific clock time.
 */
export function isDateOnlyTimestamp(ts: number): boolean {
  const d = new Date(ts);
  return d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0;
}

/**
 * Generates RFC 5545 compliant .ics content for a LedgerItem.
 * Uses only the task/event title, valid due date, and minimal metadata (kind & owner).
 * Never includes original chat messages or transcript quotes.
 */
export function generateIcsContent(item: LedgerItem, nowTs: number = Date.now()): string {
  if (!hasValidCalendarDueDate(item) || item.due === undefined) {
    throw new Error('Cannot generate .ics for an item without a valid due date.');
  }

  const summary = escapeIcsText(item.title.trim() || 'Scheduled Item');
  const descParts: string[] = [`Type: ${item.kind}`];
  if (item.owner) {
    descParts.push(`Owner: ${item.owner}`);
  }
  const description = escapeIcsText(descParts.join('\n'));
  const uid = `${item.id.replace(/[^a-zA-Z0-9_-]/g, '')}-${item.due}@receipts.local`;
  const dtStamp = formatIcsUtcDateTime(nowTs);

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Receipts//Local-First Chat Ledger//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtStamp}`,
  ];

  if (isDateOnlyTimestamp(item.due)) {
    const startDate = formatIcsDateOnly(item.due);
    const nextDay = formatIcsDateOnly(item.due + 24 * 60 * 60 * 1000);
    lines.push(`DTSTART;VALUE=DATE:${startDate}`);
    lines.push(`DTEND;VALUE=DATE:${nextDay}`);
  } else {
    const dtStart = formatIcsUtcDateTime(item.due);
    const dtEnd = formatIcsUtcDateTime(item.due + DEFAULT_EVENT_DURATION_MS);
    lines.push(`DTSTART:${dtStart}`);
    lines.push(`DTEND:${dtEnd}`);
  }

  lines.push(`SUMMARY:${summary}`);
  lines.push(`DESCRIPTION:${description}`);
  lines.push('END:VEVENT');
  lines.push('END:VCALENDAR');

  return lines.join('\r\n') + '\r\n';
}

/**
 * Builds a Google Calendar event creation URL using only the title, due time, and minimal metadata.
 * Never includes private chat transcripts or quotes.
 */
export function buildGoogleCalendarUrl(item: LedgerItem): string {
  if (!hasValidCalendarDueDate(item) || item.due === undefined) {
    return '';
  }

  const title = item.title.trim() || 'Scheduled Item';
  const detailsParts: string[] = [`Type: ${item.kind}`];
  if (item.owner) {
    detailsParts.push(`Owner: ${item.owner}`);
  }

  let datesParam = '';
  if (isDateOnlyTimestamp(item.due)) {
    const startDate = formatIcsDateOnly(item.due);
    const nextDay = formatIcsDateOnly(item.due + 24 * 60 * 60 * 1000);
    datesParam = `${startDate}/${nextDay}`;
  } else {
    const startUtc = formatIcsUtcDateTime(item.due);
    const endUtc = formatIcsUtcDateTime(item.due + DEFAULT_EVENT_DURATION_MS);
    datesParam = `${startUtc}/${endUtc}`;
  }

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: datesParam,
    details: detailsParts.join(' | '),
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * Triggers a browser download of the generated .ics file.
 */
export function downloadIcsFile(item: LedgerItem): boolean {
  try {
    const content = generateIcsContent(item);
    const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const slug = item.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 36);
    const filename = `${slug || 'event'}.ics`;

    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch {
    return false;
  }
}
