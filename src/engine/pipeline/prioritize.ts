import { LedgerItem, Msg } from '../../domain/types';

const HOUR_MS = 60 * 60 * 1000;

function formatRelativeDuration(diffMs: number): string {
  const absHours = Math.max(1, Math.round(Math.abs(diffMs) / HOUR_MS));
  if (absHours < 24) {
    return `${absHours}h`;
  }
  const days = Math.round(absHours / 24);
  return `${days}d`;
}

/**
 * Scores and assigns lanes to LedgerItems:
 * score =
 *   overdue +50;
 *   due within 24h +40;
 *   due within 72h +25;
 *   owner is me or I'm mentioned +30;
 *   unanswered question to me +20;
 *   changedWhileAway +15;
 *   recency up to +5.
 * Lane:
 *   now if score >= 60 or overdue (and status === 'open');
 *   soon if 30 to 59 (and status === 'open');
 *   fyi otherwise.
 * Done and cancelled items go to the bottom.
 */
export function prioritizeItems(
  items: LedgerItem[],
  scopedMessages: Msg[],
  referenceNowTs?: number
): LedgerItem[] {
  const msgById = new Map<number, Msg>();
  let maxMsgTs = 0;
  let minMsgTs = Number.MAX_SAFE_INTEGER;

  for (const m of scopedMessages) {
    msgById.set(m.id, m);
    if (m.ts > maxMsgTs) maxMsgTs = m.ts;
    if (m.ts < minMsgTs) minMsgTs = m.ts;
  }

  // Reference time defaults to the latest message timestamp in the chat (or provided referenceNowTs)
  const nowTs = referenceNowTs ?? (maxMsgTs > 0 ? maxMsgTs : Date.now());
  const spanMs = Math.max(1, maxMsgTs - minMsgTs);

  const scored: LedgerItem[] = items.map((item) => {
    let score = 0;
    const reasons: string[] = [];
    let isOverdue = false;

    const isDoneOrCancelled = item.status === 'done' || item.status === 'cancelled';

    if (item.due !== undefined && !isDoneOrCancelled) {
      const diff = item.due - nowTs;
      if (diff < 0) {
        score += 50;
        isOverdue = true;
        reasons.push(`Overdue by ${formatRelativeDuration(diff)}`);
      } else if (diff <= 24 * HOUR_MS) {
        score += 40;
        reasons.push(`Due in ${formatRelativeDuration(diff)}`);
      } else if (diff <= 72 * HOUR_MS) {
        score += 25;
        reasons.push(`Due in ${formatRelativeDuration(diff)}`);
      }
    }

    if (item.onMe) {
      score += 30;
      reasons.push('Mentions you');
    }

    if (item.kind === 'question' && item.onMe && item.status === 'open') {
      // Check if user replied after the question message
      const latestReceiptId = Math.max(...item.receipts.map((r) => r.msgId));
      const questionMsg = msgById.get(latestReceiptId);
      let answeredByMe = false;
      if (questionMsg && item.owner) {
        for (const m of scopedMessages) {
          if (
            m.id > questionMsg.id &&
            m.sender.toLowerCase() === item.owner.toLowerCase()
          ) {
            answeredByMe = true;
            break;
          }
        }
      }
      if (!answeredByMe) {
        score += 20;
        reasons.push('Unanswered question to you');
      }
    }

    if (item.changedWhileAway) {
      score += 15;
      reasons.push('Changed after you left');
    }

    // Recency up to +5
    const latestMsgId = Math.max(...item.receipts.map((r) => r.msgId));
    const latestMsg = msgById.get(latestMsgId);
    if (latestMsg && maxMsgTs > minMsgTs) {
      const ratio = Math.max(0, Math.min(1, (latestMsg.ts - minMsgTs) / spanMs));
      const recencyPoints = Math.round(ratio * 5);
      score += recencyPoints;
    } else if (item.receipts.length > 0) {
      score += 3;
    }

    if (reasons.length === 0) {
      if (item.fromUnread) {
        reasons.push('New while away');
      } else {
        reasons.push('Tracked item');
      }
    }

    let lane: 'now' | 'soon' | 'fyi' = 'fyi';
    if (!isDoneOrCancelled) {
      if (score >= 60 || isOverdue) {
        lane = 'now';
      } else if (score >= 30) {
        lane = 'soon';
      } else {
        lane = 'fyi';
      }
    } else {
      lane = 'fyi';
    }

    return {
      ...item,
      score,
      lane,
      reasons,
    };
  });

  // Sort: open items first, Done and cancelled items go to the bottom; within each group, descending score
  return scored.sort((a, b) => {
    const aClosed = a.status !== 'open' ? 1 : 0;
    const bClosed = b.status !== 'open' ? 1 : 0;
    if (aClosed !== bClosed) return aClosed - bClosed;
    if (b.score !== a.score) return b.score - a.score;
    const aDue = a.due ?? Number.MAX_SAFE_INTEGER;
    const bDue = b.due ?? Number.MAX_SAFE_INTEGER;
    return aDue - bDue;
  });
}
