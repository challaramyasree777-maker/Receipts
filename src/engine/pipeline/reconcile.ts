import { LedgerItem, Msg, Receipt, Revision } from '../../domain/types';
import { detectCues, extractDistinctiveTerms } from '../rules/cues';
import { parseMessageDate } from '../rules/dates';
import { detectUserMention, isOwnerMe } from '../rules/mentions';

function tokenizeTitle(title: string): Set<string> {
  const terms = extractDistinctiveTerms(title);
  if (terms.length > 0) return new Set(terms);
  const raw = title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2);
  return new Set(raw);
}

export function computeTitleJaccard(titleA: string, titleB: string): number {
  const setA = tokenizeTitle(titleA);
  const setB = tokenizeTitle(titleB);
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function sameOrCompatibleOwner(a?: string, b?: string): boolean {
  if (!a || !b) return true;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function makeShortQuote(text: string): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 20).join(' ');
}

function makeCleanRuleTitle(text: string): string {
  const cleaned = text
    .replace(/\r?\n/g, ' ')
    .replace(/^@\S+\s*/i, '')
    .trim();
  const words = cleaned.split(/\s+/).filter(Boolean);
  return words.slice(0, 12).join(' ');
}

function formatDueTimestampForRevision(ts?: number): string {
  if (!ts) return 'unscheduled';
  const d = new Date(ts);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const hours = d.getHours().toString().padStart(2, '0');
  const mins = d.getMinutes().toString().padStart(2, '0');
  return `${d.getDate()} ${months[d.getMonth()]} ${hours}:${mins}`;
}

/**
 * Generates Rules-source items directly from messages:
 * - A message with a date expression plus a commitment/request cue becomes a task/deadline
 * - A question containing one of my nicknames/mentions becomes a "question" item
 * Note: Messages that also contain a change/done/cancel cue are first checked as revisions;
 * if a message is consumed as a revision to an earlier item, we don't duplicate it as a new item.
 */
export function generateRulesItemsFromMessages(
  messages: Msg[],
  allParticipants: string[],
  lastReadTs: number,
  userName: string,
  nicknames: string[]
): LedgerItem[] {
  const items: LedgerItem[] = [];

  for (const msg of messages) {
    if (msg.isSystem) continue;

    const cues = detectCues(msg.text);
    const parsedDate = parseMessageDate(msg.text, msg.ts);
    const mentionMatch = detectUserMention(msg.text, msg.sender, userName, nicknames);

    const hasCommitment = cues.commitment.length > 0;
    const hasRequest = cues.request.length > 0;
    const hasQuestion = cues.question.length > 0;
    const hasChangeOrDoneOrCancel =
      cues.change.length > 0 || cues.done.length > 0 || cues.cancel.length > 0;

    // 1. Question containing user's name/nickname
    if (hasQuestion && (mentionMatch.mentionedMe || mentionMatch.addressedToMe)) {
      items.push({
        id: `rules-q-${msg.id}`,
        kind: 'question',
        title: makeCleanRuleTitle(msg.text),
        owner: userName.trim() || undefined,
        due: parsedDate,
        status: 'open',
        receipts: [{ msgId: msg.id, quote: makeShortQuote(msg.text) }],
        revisions: [],
        fromUnread: msg.ts >= lastReadTs,
        changedWhileAway: false,
        onMe: true,
        lane: 'fyi',
        score: 0,
        reasons: [],
        source: 'rules',
      });
      continue;
    }

    // 2. Date expression + commitment/request cue -> task or deadline
    // Skip if it's purely a revision message ("postponed to...", "moved to...") unless it also has a clear request/commitment that isn't an update
    if (parsedDate !== undefined && (hasCommitment || hasRequest) && !hasChangeOrDoneOrCancel) {
      let owner: string | undefined;
      if (hasCommitment) {
        owner = msg.sender;
      } else if (mentionMatch.mentionedMe && userName.trim()) {
        owner = userName.trim();
      } else {
        // Check if another participant is mentioned
        const lower = msg.text.toLowerCase();
        for (const p of allParticipants) {
          if (p.toLowerCase() === msg.sender.toLowerCase()) continue;
          const first = p.split(/\s+/)[0].toLowerCase();
          if (first.length >= 2 && new RegExp(`\\b${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(lower)) {
            owner = p;
            break;
          }
        }
      }

      const ownerIsMe = isOwnerMe(owner, userName, nicknames);
      const onMe = ownerIsMe || mentionMatch.mentionedMe || mentionMatch.addressedToMe;
      const kind = hasRequest && /submit|deadline|due/i.test(msg.text) ? 'deadline' : 'task';

      items.push({
        id: `rules-t-${msg.id}`,
        kind,
        title: makeCleanRuleTitle(msg.text),
        owner,
        due: parsedDate,
        status: 'open',
        receipts: [{ msgId: msg.id, quote: makeShortQuote(msg.text) }],
        revisions: [],
        fromUnread: msg.ts >= lastReadTs,
        changedWhileAway: false,
        onMe,
        lane: 'fyi',
        score: 0,
        reasons: [],
        source: 'rules',
      });
    }
  }

  return items;
}

/**
 * Merges duplicate items across windows (title token Jaccard >= 0.6, same owner or null).
 * Prefers 'ai' source if an AI item and a Rules item represent the same task.
 */
export function deduplicateItems(items: LedgerItem[], msgById: Map<number, Msg>): LedgerItem[] {
  // Sort by earliest receipt message id so chronological origin comes first
  const sorted = [...items].sort((a, b) => {
    const minA = Math.min(...a.receipts.map((r) => r.msgId));
    const minB = Math.min(...b.receipts.map((r) => r.msgId));
    if (minA !== minB) return minA - minB;
    if (a.source !== b.source) return a.source === 'ai' ? -1 : 1;
    return 0;
  });

  const merged: LedgerItem[] = [];

  for (const candidate of sorted) {
    let foundMatch: LedgerItem | undefined;
    for (const existing of merged) {
      const jaccard = computeTitleJaccard(existing.title, candidate.title);
      const sameReceiptMsg = existing.receipts.some((er) =>
        candidate.receipts.some((cr) => er.msgId === cr.msgId)
      );
      if ((jaccard >= 0.6 || sameReceiptMsg) && sameOrCompatibleOwner(existing.owner, candidate.owner)) {
        foundMatch = existing;
        break;
      }
    }

    if (!foundMatch) {
      merged.push({
        ...candidate,
        receipts: [...candidate.receipts],
        revisions: [...candidate.revisions],
        reasons: [...candidate.reasons],
      });
    } else {
      // Merge receipts without duplicates
      const existingReceiptIds = new Set(foundMatch.receipts.map((r) => r.msgId));
      for (const r of candidate.receipts) {
        if (!existingReceiptIds.has(r.msgId)) {
          foundMatch.receipts.push(r);
          existingReceiptIds.add(r.msgId);
        }
      }
      if (!foundMatch.owner && candidate.owner) {
        foundMatch.owner = candidate.owner;
      }
      if (foundMatch.due === undefined && candidate.due !== undefined) {
        foundMatch.due = candidate.due;
      }
      if (candidate.source === 'ai') {
        foundMatch.source = 'ai';
        foundMatch.title = candidate.title;
      }
      foundMatch.onMe = foundMatch.onMe || candidate.onMe;
      foundMatch.fromUnread = foundMatch.fromUnread || candidate.fromUnread;

      // Recompute earliest origin for fromUnread if needed
      const minMsgId = Math.min(...foundMatch.receipts.map((r) => r.msgId));
      const originMsg = msgById.get(minMsgId);
      if (originMsg) {
        // We keep fromUnread true if the earliest origin was in unread
      }
    }
  }

  return merged;
}

function getItemDistinctiveTerms(item: LedgerItem): Set<string> {
  const combined = [item.title, ...item.receipts.map((r) => r.quote)].join(' ');
  return new Set(extractDistinctiveTerms(combined));
}

function getItemParticipants(item: LedgerItem, msgById: Map<number, Msg>): Set<string> {
  const set = new Set<string>();
  if (item.owner) set.add(item.owner.toLowerCase());
  for (const r of item.receipts) {
    const m = msgById.get(r.msgId);
    if (m && m.sender) set.add(m.sender.toLowerCase());
  }
  return set;
}

/**
 * Reconciles items and messages in chronological order:
 * - Merges duplicate items across windows
 * - Scans later messages in time order that update an existing item (due date change, done, cancel)
 * - Rejects ambiguous matches
 * - Filters final ledger according to scope rule:
 *   show item only if (fromUnread || changedWhileAway || (status === 'open' && onMe))
 */
export function reconcileLedger(
  extractedItems: LedgerItem[],
  scopedMessages: Msg[],
  allParticipants: string[],
  lastReadTs: number,
  userName: string,
  nicknames: string[],
  includeRulesItems: boolean = true
): LedgerItem[] {
  const msgById = new Map<number, Msg>();
  for (const m of scopedMessages) {
    msgById.set(m.id, m);
  }

  const rulesItems = includeRulesItems
    ? generateRulesItemsFromMessages(scopedMessages, allParticipants, lastReadTs, userName, nicknames)
    : [];

  // Filter out any item whose receipt message itself is a later update message that will be reconciled
  // First deduplicate combined items
  const allInitial = [...extractedItems, ...rulesItems];
  const deduped = deduplicateItems(allInitial, msgById);

  // Reset revisions on each item before chronological replay so progressive re-runs are idempotent
  const workingItems: LedgerItem[] = [];
  for (const item of deduped) {
    const minMsgId = Math.min(...item.receipts.map((r) => r.msgId));
    const originMsg = msgById.get(minMsgId);
    const originInUnread = originMsg ? originMsg.ts >= lastReadTs : item.fromUnread;

    // Re-parse initial due from the origin receipt message only
    const initialDue = originMsg ? parseMessageDate(originMsg.text, originMsg.ts) ?? item.due : item.due;

    workingItems.push({
      ...item,
      due: initialDue,
      status: 'open',
      revisions: [],
      fromUnread: originInUnread,
      changedWhileAway: false,
      receipts: item.receipts.filter((r) => r.msgId === minMsgId),
    });
  }

  // Sort messages chronologically
  const sortedMessages = [...scopedMessages].sort((a, b) => a.ts - b.ts || a.id - b.id);
  const consumedRevisionMsgIds = new Set<number>();

  for (const msg of sortedMessages) {
    if (msg.isSystem) continue;

    const cues = detectCues(msg.text);
    const hasChange = cues.change.length > 0;
    const hasDone = cues.done.length > 0;
    const hasCancel = cues.cancel.length > 0;

    // Condition (a): message contains a change, done, or cancel cue
    if (!hasChange && !hasDone && !hasCancel) {
      continue;
    }

    const msgTerms = extractDistinctiveTerms(msg.text);
    if (msgTerms.length === 0) {
      continue;
    }

    // Score all earlier items (origin msgId < msg.id)
    interface CandidateScore {
      item: LedgerItem;
      sharedTermCount: number;
      totalScore: number;
    }

    const candidates: CandidateScore[] = [];

    for (const item of workingItems) {
      const originMsgId = Math.min(...item.receipts.map((r) => r.msgId));
      if (originMsgId >= msg.id) continue;

      const itemTerms = getItemDistinctiveTerms(item);
      let sharedTerms = 0;
      for (const t of msgTerms) {
        if (itemTerms.has(t)) {
          sharedTerms++;
        } else {
          // Prefix/stem match for words >= 4 chars (e.g. "slides" vs "slide", "budget" vs "budgets")
          for (const it of itemTerms) {
            if (t.length >= 4 && it.length >= 4 && (t.startsWith(it) || it.startsWith(t))) {
              sharedTerms++;
              break;
            }
          }
        }
      }

      // Condition (b): shares at least one distinctive term with item's title or receipt quote
      if (sharedTerms === 0) continue;

      // Supporting signal: participants (who is speaking and who is mentioned)
      const itemParticipants = getItemParticipants(item, msgById);
      let participantBonus = 0;
      if (itemParticipants.has(msg.sender.toLowerCase())) {
        participantBonus += 0.35;
      }
      const lowerMsg = msg.text.toLowerCase();
      for (const part of itemParticipants) {
        const first = part.split(/\s+/)[0];
        if (first.length >= 2 && lowerMsg.includes(first)) {
          participantBonus += 0.25;
          break;
        }
      }

      const totalScore = sharedTerms * 1.0 + participantBonus;
      candidates.push({
        item,
        sharedTermCount: sharedTerms,
        totalScore,
      });
    }

    if (candidates.length === 0) continue;

    candidates.sort((a, b) => b.totalScore - a.totalScore);

    // Condition (c): single clearly best match, meaning no other item scores close to it
    if (candidates.length >= 2) {
      const best = candidates[0];
      const runnerUp = candidates[1];
      // If two items have the same shared term count or score within 0.5 of each other, reject as ambiguous!
      if (
        best.sharedTermCount === runnerUp.sharedTermCount &&
        Math.abs(best.totalScore - runnerUp.totalScore) < 0.5
      ) {
        continue;
      }
    }

    const matchedItem = candidates[0].item;
    let appliedUpdate = false;

    const newParsedDate = parseMessageDate(msg.text, msg.ts);

    // Check cancel cue first
    if (hasCancel && matchedItem.status !== 'cancelled') {
      const prevStatus = matchedItem.status;
      matchedItem.status = 'cancelled';
      const rev: Revision = {
        msgId: msg.id,
        by: msg.sender,
        field: 'status',
        from: prevStatus,
        to: 'cancelled',
      };
      matchedItem.revisions.push(rev);
      appliedUpdate = true;
    } else if (hasDone && !hasChange && matchedItem.status !== 'done') {
      const prevStatus = matchedItem.status;
      matchedItem.status = 'done';
      const rev: Revision = {
        msgId: msg.id,
        by: msg.sender,
        field: 'status',
        from: prevStatus,
        to: 'done',
      };
      matchedItem.revisions.push(rev);
      appliedUpdate = true;
    }

    // Check due date revision if message has a different parseable date
    if (newParsedDate !== undefined && !hasCancel && !hasDone) {
      const oldDue = matchedItem.due;
      // Consider different if oldDue was undefined or differs by more than 1 minute
      if (oldDue === undefined || Math.abs(newParsedDate - oldDue) > 60 * 1000) {
        const rev: Revision = {
          msgId: msg.id,
          by: msg.sender,
          field: 'due',
          from: formatDueTimestampForRevision(oldDue),
          to: formatDueTimestampForRevision(newParsedDate),
        };
        matchedItem.due = newParsedDate;
        matchedItem.revisions.push(rev);
        appliedUpdate = true;
      }
    }

    if (appliedUpdate) {
      consumedRevisionMsgIds.add(msg.id);
      if (msg.ts >= lastReadTs) {
        matchedItem.changedWhileAway = true;
      }
      // Also attach this revision message to receipts so user can inspect all evidence
      if (!matchedItem.receipts.some((r) => r.msgId === msg.id)) {
        const revReceipt: Receipt = {
          msgId: msg.id,
          quote: makeShortQuote(msg.text),
        };
        matchedItem.receipts.push(revReceipt);
      }
    }
  }

  // Remove any standalone item whose primary origin receipt was actually consumed as a revision to an earlier item
  const unconsumedItems = workingItems.filter((item) => {
    const firstReceiptId = item.receipts[0]?.msgId;
    return firstReceiptId === undefined || !consumedRevisionMsgIds.has(firstReceiptId);
  });

  // Apply Scope filter:
  // "the ledger shows an item only if it originates in the unread portion,
  // OR was changed in the unread portion, OR is still open and on the user."
  return unconsumedItems.filter(
    (item) =>
      item.fromUnread ||
      item.changedWhileAway ||
      (item.status === 'open' && item.onMe)
  );
}
