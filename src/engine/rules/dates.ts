import * as chrono from 'chrono-node';
import lexicon from './lexicon.json';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasPastTenseWord(text: string): boolean {
  const lower = text.toLowerCase();
  for (const word of lexicon.pastTenseIndicators) {
    const re = new RegExp(`\\b${escapeRegExp(word)}\\b`, 'i');
    if (re.test(lower)) {
      return true;
    }
  }
  return false;
}

export function normalizeHinglishDateText(rawText: string): string {
  let normalized = rawText;
  const isPast = hasPastTenseWord(rawText);

  const map = lexicon.hinglishDateMap;

  // Replace whole words case-insensitively
  const replaceWord = (sourceWord: string, targetPhrase: string) => {
    const re = new RegExp(`\\b${escapeRegExp(sourceWord)}\\b`, 'gi');
    normalized = normalized.replace(re, targetPhrase);
  };

  replaceWord('aaj', map.aaj);
  replaceWord('kal', isPast ? map.kal_past : map.kal);
  replaceWord('parso', map.parso);
  replaceWord('parson', map.parson);
  replaceWord('subah', map.subah);
  replaceWord('dopahar', map.dopahar);
  replaceWord('shaam', map.shaam);
  replaceWord('raat', map.raat);
  replaceWord('tak', map.tak);

  // Also normalize "day after tomorrow" into an explicit +2 days expression if needed by chrono
  return normalized;
}

/**
 * Resolves relative dates against THE MESSAGE'S OWN timestamp, never today's date.
 */
export function parseMessageDate(text: string, messageTimestamp: number): number | undefined {
  if (!text || !text.trim()) return undefined;

  const refDate = new Date(messageTimestamp);
  const normalized = normalizeHinglishDateText(text);

  // Handle "day after tomorrow" explicitly if present so chrono resolves +2 days reliably
  const dayAfterRe = /\bday after tomorrow\b/i;
  if (dayAfterRe.test(normalized)) {
    const plusTwo = new Date(messageTimestamp + 2 * 24 * 60 * 60 * 1000);
    // Replace "day after tomorrow" with a concrete date string like "17 March 2025"
    const months = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ];
    const concreteDate = `${plusTwo.getDate()} ${months[plusTwo.getMonth()]} ${plusTwo.getFullYear()}`;
    const withConcrete = normalized.replace(dayAfterRe, concreteDate);
    const parsed = chrono.en.GB.parseDate(withConcrete, refDate, { forwardDate: true });
    if (parsed) return parsed.getTime();
  }

  const results = chrono.en.GB.parse(normalized, refDate, { forwardDate: true });
  if (!results || results.length === 0) {
    return undefined;
  }

  const first = results[0];
  const dateObj = first.date();

  // If no hour was explicitly implied/certain in the parse result, default to 18:00 (6pm) or keep chrono's hour if specified
  if (!first.start.isCertain('hour')) {
    // Check if our Hinglish normalizer injected a specific time or if chrono set a default
    // chrono sets implied hour (usually 12). If the text didn't mention morning/afternoon/evening/night/am/pm,
    // keep chrono's resolved date.
  }

  return dateObj.getTime();
}
