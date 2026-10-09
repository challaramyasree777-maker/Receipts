function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}

export type MentionMatch = {
  mentionedMe: boolean;
  addressedToMe: boolean;
  matchedTerm?: string;
};

/**
 * Builds the list of normalized search tokens for the current user
 * (full name, first name if >= 3 chars, and user-provided nicknames).
 */
export function buildUserAliases(userName: string, nicknames: string[]): string[] {
  const raw = new Set<string>();
  const trimmedName = userName.trim().toLowerCase();
  if (trimmedName) {
    raw.add(trimmedName);
    const parts = trimmedName.split(/\s+/);
    if (parts[0] && parts[0].length >= 2) {
      raw.add(parts[0]);
    }
  }
  for (const nick of nicknames) {
    const clean = nick.trim().toLowerCase().replace(/^@+/, '');
    if (clean) raw.add(clean);
  }
  return Array.from(raw);
}

/**
 * Detects "@name", the user's name and nicknames (case-insensitive, whole word,
 * small edit-distance tolerance for spelling variants), and addressed-to-me.
 */
export function detectUserMention(
  text: string,
  sender: string,
  userName: string,
  nicknames: string[]
): MentionMatch {
  if (!userName.trim() && nicknames.length === 0) {
    return { mentionedMe: false, addressedToMe: false };
  }

  // If I sent the message myself, it's not someone else mentioning/addressing me
  if (userName.trim() && sender.trim().toLowerCase() === userName.trim().toLowerCase()) {
    return { mentionedMe: false, addressedToMe: false };
  }

  const aliases = buildUserAliases(userName, nicknames);
  const lowerText = text.toLowerCase();

  // 1. Direct whole-word or @mention match
  for (const alias of aliases) {
    if (!alias) continue;
    const atPattern = new RegExp(`(?:^|\\s)@${escapeRegExp(alias)}\\b`, 'i');
    const wordPattern = new RegExp(`\\b${escapeRegExp(alias)}\\b`, 'i');

    if (atPattern.test(lowerText) || wordPattern.test(lowerText)) {
      const startAddressPattern = new RegExp(
        `^(?:hey|hi|hello|dear|yo|oi|sun|suno)?\\s*@?${escapeRegExp(alias)}\\b`,
        'i'
      );
      return {
        mentionedMe: true,
        addressedToMe: startAddressPattern.test(lowerText.trim()) || atPattern.test(lowerText),
        matchedTerm: alias,
      };
    }
  }

  // 2. Small edit-distance tolerance for single-word aliases (length >= 4 -> max distance 1; length >= 7 -> max distance 2)
  const words = lowerText
    .replace(/[^\p{L}\p{N}@\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);

  for (let idx = 0; idx < words.length; idx++) {
    const rawWord = words[idx];
    const hadAt = rawWord.startsWith('@');
    const cleanWord = rawWord.replace(/^@+/, '');
    if (cleanWord.length < 4) continue;

    for (const alias of aliases) {
      if (alias.includes(' ') || alias.length < 4) continue;
      if (Math.abs(cleanWord.length - alias.length) > 2) continue;
      // Require same first letter to avoid false positives on short English words
      if (cleanWord[0] !== alias[0]) continue;

      const maxAllowed = alias.length >= 7 ? 2 : 1;
      const dist = levenshteinDistance(cleanWord, alias);
      if (dist <= maxAllowed) {
        return {
          mentionedMe: true,
          addressedToMe: hadAt || idx <= 1,
          matchedTerm: cleanWord,
        };
      }
    }
  }

  return { mentionedMe: false, addressedToMe: false };
}

export function isOwnerMe(owner: string | undefined | null, userName: string, nicknames: string[]): boolean {
  if (!owner) return false;
  const cleanOwner = owner.trim().toLowerCase().replace(/^@+/, '');
  if (!cleanOwner) return false;
  if (cleanOwner === 'me' || cleanOwner === 'you') return true;

  const aliases = buildUserAliases(userName, nicknames);
  for (const alias of aliases) {
    if (cleanOwner === alias) return true;
    if (alias.length >= 4 && cleanOwner[0] === alias[0] && levenshteinDistance(cleanOwner, alias) <= 1) {
      return true;
    }
  }
  return false;
}
