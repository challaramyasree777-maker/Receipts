import { LedgerItem, Msg } from '../../domain/types';

export type DraftReplyResult = {
  draftText: string;
  isGenericTemplate: boolean;
  contextLabel: string;
  recipientSender?: string;
};

/**
 * Checks whether a ledger card supports the Draft Reply action.
 * Relevant for open Question and Task/Deadline cards.
 */
export function canDraftReply(item: LedgerItem): boolean {
  if (item.status !== 'open') return false;
  return item.kind === 'question' || item.kind === 'task' || item.kind === 'deadline';
}

/**
 * Deterministically generates a safe, editable reply draft from verified source messages
 * and available context without inventing facts, claiming completion, or promising new deadlines.
 */
export function generateDraftReply(
  item: LedgerItem,
  messages: Msg[]
): DraftReplyResult {
  const msgById = new Map<number, Msg>();
  for (const m of messages) {
    msgById.set(m.id, m);
  }

  const primaryReceipt = item.receipts[0];
  const sourceMsg = primaryReceipt ? msgById.get(primaryReceipt.msgId) : undefined;
  const senderName =
    sourceMsg && !sourceMsg.isSystem && sourceMsg.sender !== 'System'
      ? sourceMsg.sender
      : undefined;

  const cleanTitle = item.title.trim();

  // If context is missing or title is too short/generic, provide a clearly labeled generic template
  if (!sourceMsg || cleanTitle.length < 4) {
    return {
      draftText: senderName
        ? `Hi ${senderName}, following up on your message — [add your update here].`
        : 'Hi, following up on this message — [add your update here].',
      isGenericTemplate: true,
      contextLabel: 'Generic template (insufficient message context)',
      recipientSender: senderName,
    };
  }

  if (item.kind === 'question') {
    const greeting = senderName ? `Hi ${senderName},` : 'Hi,';
    return {
      draftText: `${greeting} regarding "${cleanTitle}" — I saw your question and am checking on the details now. [Add your answer here]`,
      isGenericTemplate: false,
      contextLabel: senderName
        ? `Drafted for ${senderName}'s question (msg #${sourceMsg.id})`
        : `Drafted for question (msg #${sourceMsg.id})`,
      recipientSender: senderName,
    };
  }

  // Task or deadline acknowledgement without making unsupported commitments
  const greeting = senderName ? `Hi ${senderName},` : 'Hi,';
  return {
    draftText: `${greeting} acknowledging "${cleanTitle}". Reviewing this now — [add current status or next step here].`,
    isGenericTemplate: false,
    contextLabel: senderName
      ? `Drafted for ${senderName}'s task request (msg #${sourceMsg.id})`
      : `Drafted for task (msg #${sourceMsg.id})`,
    recipientSender: senderName,
  };
}
