import lexicon from './lexicon.json';

export type CueCategory = keyof typeof lexicon.cues;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchesCuePhrase(lowerText: string, phrase: string): boolean {
  const lowerPhrase = phrase.toLowerCase().trim();
  if (!lowerPhrase) return false;

  if (lowerPhrase === '?') {
    return lowerText.includes('?');
  }

  // If phrase ends with punctuation like "status?", check substring with word boundary at start
  if (/[^\w\s]$/.test(lowerPhrase)) {
    const re = new RegExp(`\\b${escapeRegExp(lowerPhrase)}`, 'i');
    return re.test(lowerText);
  }

  const re = new RegExp(`\\b${escapeRegExp(lowerPhrase)}\\b`, 'i');
  return re.test(lowerText);
}

export function detectCues(text: string): Record<CueCategory, string[]> {
  const lower = text.toLowerCase();
  const result: Record<CueCategory, string[]> = {
    commitment: [],
    request: [],
    question: [],
    change: [],
    done: [],
    cancel: [],
  };

  (Object.keys(lexicon.cues) as CueCategory[]).forEach((category) => {
    const list = lexicon.cues[category];
    for (const phrase of list) {
      if (matchesCuePhrase(lower, phrase)) {
        result[category].push(phrase);
      }
    }
  });

  return result;
}

export function hasCategoryCue(text: string, category: CueCategory): boolean {
  const lower = text.toLowerCase();
  const list = lexicon.cues[category];
  return list.some((phrase) => matchesCuePhrase(lower, phrase));
}

export function hasAnyCue(text: string): boolean {
  const categories = Object.keys(lexicon.cues) as CueCategory[];
  return categories.some((cat) => hasCategoryCue(text, cat));
}

const STOP_WORDS_SET = new Set(lexicon.stopWords.map((w) => w.toLowerCase()));

export function extractDistinctiveTerms(text: string): string[] {
  const cleaned = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !STOP_WORDS_SET.has(token) && !/^\d+$/.test(token));

  return Array.from(new Set(cleaned));
}
