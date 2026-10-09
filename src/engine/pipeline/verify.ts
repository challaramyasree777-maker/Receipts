import { ExtractedRawItem, LedgerItem, Msg, Receipt } from '../../domain/types';
import { parseMessageDate } from '../rules/dates';
import { detectUserMention, isOwnerMe } from '../rules/mentions';

export type VerificationResult = {
  verifiedItems: LedgerItem[];
  rejectedCount: number;
};

/**
 * Normalizes text for receipt quote verification:
 * lowercase, collapse punctuation/quotes to spaces, collapse whitespace.
 */
export function normalizeForQuoteMatch(input: string): string {
  return input
    .toLowerCase()
    .replace(/['’`"]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isQuoteVerbatimInMessage(quote: string, messageText: string): boolean {
  const trimmedQuote = quote.trim();
  if (!trimmedQuote) return false;

  // Enforce max 20 words rule (allow slight slack up to 24 words if model counted punctuation differently, or check raw words)
  const wordCount = trimmedQuote.split(/\s+/).filter(Boolean).length;
  if (wordCount === 0 || wordCount > 24) return false;

  const normQuote = normalizeForQuoteMatch(trimmedQuote);
  const normMsg = normalizeForQuoteMatch(messageText);

  if (!normQuote || !normMsg) return false;
  return normMsg.includes(normQuote);
}

export function resolveValidParticipant(
  rawOwner: string | null | undefined,
  participants: string[],
  evidenceText?: string
): { valid: boolean; canonicalOwner?: string } {
  if (rawOwner === null || rawOwner === undefined || rawOwner.trim() === '') {
    return { valid: true, canonicalOwner: undefined };
  }

  const cleaned = rawOwner.trim().replace(/^@+/, '').toLowerCase();
  if (!cleaned || cleaned === 'null' || cleaned === 'none' || cleaned === 'anyone' || cleaned === 'unassigned') {
    return { valid: true, canonicalOwner: undefined };
  }

  for (const p of participants) {
    const pLower = p.trim().toLowerCase();
    const pFirst = pLower.split(/\s+/)[0];
    if (pLower === cleaned || pFirst === cleaned) {
      return { valid: true, canonicalOwner: p };
    }
  }

  // Also allow if the person was explicitly @mentioned in the evidence message text
  if (evidenceText) {
    const escaped = cleaned.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const atRe = new RegExp(`@${escaped}\\b`, 'i');
    if (atRe.test(evidenceText)) {
      return { valid: true, canonicalOwner: rawOwner.trim().replace(/^@+/, '') };
    }
  }

  return { valid: false };
}

const VALID_KINDS = new Set(['task', 'decision', 'deadline', 'question']);

export function verifyExtractedItems(
  rawItems: ExtractedRawItem[],
  windowMessages: Msg[],
  allParticipants: string[],
  lastReadTs: number,
  userName: string,
  nicknames: string[]
): VerificationResult {
  const msgById = new Map<number, Msg>();
  for (const m of windowMessages) {
    msgById.set(m.id, m);
  }

  const verifiedItems: LedgerItem[] = [];
  let rejectedCount = 0;

  for (let i = 0; i < rawItems.length; i++) {
    const raw = rawItems[i];
    if (!raw || typeof raw !== 'object') {
      rejectedCount++;
      continue;
    }

    if (!VALID_KINDS.has(raw.kind)) {
      rejectedCount++;
      continue;
    }

    const title = typeof raw.title === 'string' ? raw.title.trim() : '';
    if (!title) {
      rejectedCount++;
      continue;
    }

    if (!Array.isArray(raw.evidence) || raw.evidence.length === 0) {
      rejectedCount++;
      continue;
    }

    // Check every evidence id exists in that window AND its quote matches that message's text
    const receipts: Receipt[] = [];
    let allEvidenceValid = true;
    let primaryEvidenceMsg: Msg | undefined;

    for (const ev of raw.evidence) {
      if (!ev || typeof ev.id !== 'number' || typeof ev.quote !== 'string') {
        allEvidenceValid = false;
        break;
      }
      const targetMsg = msgById.get(ev.id);
      if (!targetMsg) {
        allEvidenceValid = false;
        break;
      }
      if (!isQuoteVerbatimInMessage(ev.quote, targetMsg.text)) {
        allEvidenceValid = false;
        break;
      }
      receipts.push({
        msgId: targetMsg.id,
        quote: ev.quote.trim(),
      });
      if (!primaryEvidenceMsg) {
        primaryEvidenceMsg = targetMsg;
      }
    }

    if (!allEvidenceValid || !primaryEvidenceMsg || receipts.length === 0) {
      rejectedCount++;
      continue;
    }

    // Verify owner is a real participant, mentioned @handle in the evidence message, or null
    const ownerCheck = resolveValidParticipant(raw.owner, allParticipants, primaryEvidenceMsg.text);
    if (!ownerCheck.valid) {
      rejectedCount++;
      continue;
    }

    // Ignore any date the model computes: parse due_text with rules/dates.ts relative to the evidence message's timestamp
    let parsedDue: number | undefined;
    if (typeof raw.due_text === 'string' && raw.due_text.trim()) {
      parsedDue = parseMessageDate(raw.due_text, primaryEvidenceMsg.ts);
    }
    if (parsedDue === undefined) {
      parsedDue = parseMessageDate(primaryEvidenceMsg.text, primaryEvidenceMsg.ts);
    }

    const fromUnread = receipts.some((r) => {
      const m = msgById.get(r.msgId);
      return m ? m.ts >= lastReadTs : false;
    });

    const mentionMatch = detectUserMention(
      primaryEvidenceMsg.text,
      primaryEvidenceMsg.sender,
      userName,
      nicknames
    );
    const ownerIsMe = isOwnerMe(ownerCheck.canonicalOwner, userName, nicknames);
    const onMe = ownerIsMe || mentionMatch.mentionedMe || mentionMatch.addressedToMe;

    // Truncate title to max 12 words if LLM exceeded slightly
    const words = title.split(/\s+/);
    const cleanTitle = words.length > 12 ? words.slice(0, 12).join(' ') : title;

    verifiedItems.push({
      id: `ai-${primaryEvidenceMsg.id}-${i}`,
      kind: raw.kind,
      title: cleanTitle,
      owner: ownerCheck.canonicalOwner,
      due: parsedDue,
      status: 'open',
      receipts,
      revisions: [],
      fromUnread,
      changedWhileAway: false,
      onMe,
      lane: 'fyi',
      score: 0,
      reasons: [],
      source: 'ai',
    });
  }

  return {
    verifiedItems,
    rejectedCount,
  };
}
