import { CatchUpBrief, LedgerItem, Msg } from '../../domain/types';

function formatShortDateTime(ts: number): string {
  const d = new Date(ts);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const hours = d.getHours().toString().padStart(2, '0');
  const mins = d.getMinutes().toString().padStart(2, '0');
  return `${d.getDate()} ${months[d.getMonth()]} ${hours}:${mins}`;
}

/**
 * Builds the "Catch-up brief" deterministically from computed data only,
 * with no AI-written text and no invented content.
 */
export function buildCatchUpBrief(
  items: LedgerItem[],
  unreadMessages: Msg[]
): CatchUpBrief {
  const nonSystemUnread = unreadMessages.filter((m) => !m.isSystem);
  const unreadMessageCount = nonSystemUnread.length;

  const participantSet = new Set<string>();
  let minTs = Number.MAX_SAFE_INTEGER;
  let maxTs = 0;

  for (const m of nonSystemUnread) {
    participantSet.add(m.sender);
    if (m.ts < minTs) minTs = m.ts;
    if (m.ts > maxTs) maxTs = m.ts;
  }

  const participantCount = participantSet.size;
  const timeSpanText =
    unreadMessageCount > 0 && minTs <= maxTs
      ? `${formatShortDateTime(minTs)} – ${formatShortDateTime(maxTs)}`
      : 'No unread window';

  const countsByKind = {
    task: 0,
    decision: 0,
    deadline: 0,
    question: 0,
  };

  let changedWhileAwayCount = 0;

  for (const item of items) {
    countsByKind[item.kind] = (countsByKind[item.kind] || 0) + 1;
    if (item.changedWhileAway) {
      changedWhileAwayCount++;
    }
  }

  if (items.length === 0) {
    return {
      isEmpty: true,
      emptyText: 'Nothing needs you in this part of the chat.',
      unreadMessageCount,
      timeSpanText,
      participantCount,
      countsByKind,
      topNowItems: [],
      changedWhileAwayCount: 0,
      summaryLines: ['Nothing needs you in this part of the chat.'],
    };
  }

  const nowItems = items
    .filter((i) => i.lane === 'now' && i.status === 'open')
    .slice(0, 3)
    .map((i) => ({
      id: i.id,
      title: i.title,
      due: i.due,
      dueFormatted: i.due !== undefined ? formatShortDateTime(i.due) : undefined,
    }));

  const summaryLines: string[] = [];
  summaryLines.push(
    `${unreadMessageCount} unread ${unreadMessageCount === 1 ? 'message' : 'messages'} from ${participantCount} ${participantCount === 1 ? 'person' : 'people'} (${timeSpanText}).`
  );

  const kindParts: string[] = [];
  if (countsByKind.task > 0) kindParts.push(`${countsByKind.task} ${countsByKind.task === 1 ? 'task' : 'tasks'}`);
  if (countsByKind.deadline > 0) kindParts.push(`${countsByKind.deadline} ${countsByKind.deadline === 1 ? 'deadline' : 'deadlines'}`);
  if (countsByKind.decision > 0) kindParts.push(`${countsByKind.decision} ${countsByKind.decision === 1 ? 'decision' : 'decisions'}`);
  if (countsByKind.question > 0) kindParts.push(`${countsByKind.question} ${countsByKind.question === 1 ? 'question' : 'questions'}`);

  if (kindParts.length > 0) {
    summaryLines.push(`Tracked ${kindParts.join(', ')}.`);
  }

  if (changedWhileAwayCount > 0) {
    summaryLines.push(
      `${changedWhileAwayCount} ${changedWhileAwayCount === 1 ? 'item' : 'items'} changed while you were away.`
    );
  }

  return {
    isEmpty: false,
    emptyText: '',
    unreadMessageCount,
    timeSpanText,
    participantCount,
    countsByKind,
    topNowItems: nowItems,
    changedWhileAwayCount,
    summaryLines,
  };
}

function formatItemLineForMarkdown(item: LedgerItem): string {
  const metaParts: string[] = [];
  if (item.owner) {
    metaParts.push(`Owner: ${item.owner}`);
  }
  if (item.due !== undefined) {
    metaParts.push(`Due: ${formatShortDateTime(item.due)}`);
  }
  const suffix = metaParts.length > 0 ? ` (${metaParts.join(' · ')})` : '';
  return `- **${item.title}**${suffix}`;
}

/**
 * Deterministically formats the Catch-up Brief and visible open ledger items as clean Markdown.
 * Excludes completed or cancelled items from open-items sections and omits raw chat transcripts/quotes.
 */
export function formatBriefAsMarkdown(
  brief: CatchUpBrief,
  items: LedgerItem[]
): string {
  const lines: string[] = ['# Catch-Up Brief'];
  lines.push('');

  if (brief.isEmpty || items.length === 0) {
    lines.push(brief.emptyText || 'Nothing needs you in this part of the chat.');
    return lines.join('\n');
  }

  for (const summaryLine of brief.summaryLines) {
    lines.push(summaryLine);
  }

  const openItems = items.filter((i) => i.status === 'open');
  const openTasksAndDeadlines = openItems.filter(
    (i) => i.kind === 'task' || i.kind === 'deadline' || i.kind === 'decision'
  );
  const openQuestions = openItems.filter((i) => i.kind === 'question');
  const changedItems = items.filter((i) => i.revisions.length > 0 || i.changedWhileAway);

  if (openTasksAndDeadlines.length > 0) {
    lines.push('');
    lines.push('## Open Tasks & Deadlines');
    for (const item of openTasksAndDeadlines) {
      lines.push(formatItemLineForMarkdown(item));
    }
  }

  if (openQuestions.length > 0) {
    lines.push('');
    lines.push('## Unanswered Questions');
    for (const q of openQuestions) {
      lines.push(formatItemLineForMarkdown(q));
    }
  }

  if (changedItems.length > 0) {
    lines.push('');
    lines.push('## Recent Changes');
    for (const item of changedItems) {
      if (item.revisions.length > 0) {
        for (const rev of item.revisions) {
          lines.push(
            `- **${item.title}** — ${rev.field}: ~${rev.from}~ → **${rev.to}** (by ${rev.by})`
          );
        }
      } else {
        lines.push(`- **${item.title}** — updated while you were away`);
      }
    }
  }

  return lines.join('\n');
}
