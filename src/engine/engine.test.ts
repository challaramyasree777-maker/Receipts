import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ExtractedWindowResponse, LedgerItem } from '../domain/types';
import { LLMEngine } from './llm/engine';
import { parseWhatsAppText, WhatsAppParseError } from './parser/whatsapp';
import { buildCatchUpBrief, formatBriefAsMarkdown } from './pipeline/brief';
import {
  hasValidCalendarDueDate,
  escapeIcsText,
  generateIcsContent,
  buildGoogleCalendarUrl,
} from './pipeline/calendar';
import { canDraftReply, generateDraftReply } from './pipeline/reply';
import { buildScopedWindows } from './pipeline/chunk';
import { prioritizeItems } from './pipeline/prioritize';
import { reconcileLedger } from './pipeline/reconcile';
import { runPipeline } from './pipeline/run';
import { verifyExtractedItems } from './pipeline/verify';
import { parseMessageDate } from './rules/dates';
import { detectUserMention } from './rules/mentions';

describe('1. WhatsApp Parser (Android, iOS, U+202F, multi-line, dd/mm, invalid format)', () => {
  it('parses Android export with U+200E, U+202F narrow no-break space, multi-line, and system messages', () => {
    const raw = [
      '\u200E15/03/25, 9:15\u202Fam - Messages and calls are end-to-end encrypted.',
      '15/03/25, 9:20\u202Fam - Rohan: Hey team, starting the release checklist.',
      'Second line of the checklist message.',
      '15/03/25, 9:22\u202Fam - Priya: <Media omitted>',
      '15/03/25, 9:25\u202Fam - Ananya: This message was deleted',
      '15/03/25, 2:30\u202Fpm - Priya: Please review the API spec by tomorrow.',
    ].join('\n');

    const res = parseWhatsAppText(raw);
    expect(res.dateOrder).toBe('dmy');
    expect(res.messages).toHaveLength(5);

    expect(res.messages[0].isSystem).toBe(true);
    expect(res.messages[1].sender).toBe('Rohan');
    expect(res.messages[1].text).toContain('Second line of the checklist message.');
    expect(res.messages[1].isSystem).toBe(false);

    expect(res.messages[2].isSystem).toBe(true);
    expect(res.messages[3].isSystem).toBe(true);
    expect(res.messages[4].sender).toBe('Priya');
    expect(res.senders).toEqual(['Rohan', 'Priya']);
  });

  it('parses iOS bracketed export with 24h and 4-digit year', () => {
    const raw = [
      '[18/04/2025, 14:05:10] Kabir: Can someone deploy staging?',
      '[18/04/2025, 14:06:00] Meera: I will deploy staging today.',
    ].join('\n');

    const res = parseWhatsAppText(raw);
    expect(res.dateOrder).toBe('dmy');
    expect(res.messages).toHaveLength(2);
    expect(res.messages[0].sender).toBe('Kabir');
    expect(res.messages[1].sender).toBe('Meera');
  });

  it('throws friendly WhatsAppParseError on invalid text format or oversized input', () => {
    expect(() => parseWhatsAppText('Just a normal paragraph with no timestamps.')).toThrow(
      WhatsAppParseError
    );
    expect(() => parseWhatsAppText('15/03/25, 9:20 am - A: hi', 25 * 1024 * 1024)).toThrow(
      /20 MB/
    );
  });
});

describe('2. Relative Dates & Hinglish Normalizer', () => {
  it('resolves relative English and Hinglish ("kal shaam tak") against the message timestamp, never today', () => {
    // Message sent on 10 March 2025 at 10:00 local time
    const msgDate = new Date(2025, 2, 10, 10, 0, 0, 0).getTime();

    const parsedKalShaam = parseMessageDate('Report kal shaam tak bhej do', msgDate);
    expect(parsedKalShaam).toBeDefined();
    const resolved = new Date(parsedKalShaam!);
    expect(resolved.getFullYear()).toBe(2025);
    expect(resolved.getMonth()).toBe(2); // March
    expect(resolved.getDate()).toBe(11); // Tomorrow relative to 10 March
    expect(resolved.getHours()).toBe(18); // shaam = 6:00 pm

    // Past tense indicator ("tha") turns "kal" into yesterday (9 March)
    const parsedKalPast = parseMessageDate('Meeting kal subah tha', msgDate);
    expect(parsedKalPast).toBeDefined();
    const resolvedPast = new Date(parsedKalPast!);
    expect(resolvedPast.getDate()).toBe(9);
  });
});

describe('3. Mentions and Nicknames', () => {
  it('detects @name, nicknames, and small spelling variants with edit distance', () => {
    const m1 = detectUserMention('Hey @rohu can you check the build?', 'Priya', 'Rohan Sharma', ['rohu']);
    expect(m1.mentionedMe).toBe(true);
    expect(m1.addressedToMe).toBe(true);

    // Small spelling variant "Rohn" for "Rohan" (length 5, edit distance 1)
    const m2 = detectUserMention('Rohn please share the deck', 'Priya', 'Rohan', []);
    expect(m2.mentionedMe).toBe(true);

    // Self-message does not count as someone mentioning me
    const mSelf = detectUserMention('I am Rohan checking in', 'Rohan', 'Rohan', []);
    expect(mSelf.mentionedMe).toBe(false);
  });
});

describe('4. Verifier (RECEIPTS)', () => {
  it('rejects items with fabricated quotes or non-existent owners and keeps verified ones', () => {
    const msgTs = new Date(2025, 2, 10, 10, 0, 0).getTime();
    const windowMessages = [
      {
        id: 10,
        ts: msgTs,
        sender: 'Priya',
        text: 'Rohan please submit the security audit by tomorrow.',
        isSystem: false,
      },
    ];

    const result = verifyExtractedItems(
      [
        {
          kind: 'deadline',
          title: 'Submit security audit',
          owner: 'Rohan',
          due_text: 'tomorrow',
          evidence: [{ id: 10, quote: 'please submit the security audit by tomorrow' }],
        },
        {
          kind: 'task',
          title: 'Hallucinated task',
          owner: 'Rohan',
          due_text: null,
          evidence: [{ id: 10, quote: 'this quote does not exist in message ten at all' }],
        },
        {
          kind: 'task',
          title: 'Ghost owner task',
          owner: 'ImaginaryPerson',
          due_text: null,
          evidence: [{ id: 10, quote: 'submit the security audit' }],
        },
      ],
      windowMessages,
      ['Priya', 'Rohan'],
      msgTs - 1000,
      'Rohan',
      []
    );

    expect(result.verifiedItems).toHaveLength(1);
    expect(result.rejectedCount).toBe(2);
    expect(result.verifiedItems[0].title).toBe('Submit security audit');
    expect(result.verifiedItems[0].onMe).toBe(true);
  });
});

describe('5. Reconcile (REVISIONS) & Ambiguity Rejection', () => {
  it('creates a Revision when a deadline moves and updates to the latest value', () => {
    const t1 = new Date(2025, 2, 10, 9, 0).getTime();
    const t2 = new Date(2025, 2, 10, 14, 0).getTime();
    const messages = [
      {
        id: 1,
        ts: t1,
        sender: 'Priya',
        text: 'Please submit the budget spreadsheet tomorrow.',
        isSystem: false,
      },
      {
        id: 2,
        ts: t2,
        sender: 'Priya',
        text: 'Budget spreadsheet postponed to 14 March.',
        isSystem: false,
      },
    ];

    const reconciled = reconcileLedger([], messages, ['Priya', 'Rohan'], t1, 'Rohan', []);
    expect(reconciled).toHaveLength(1);
    const item = reconciled[0];
    expect(item.revisions).toHaveLength(1);
    expect(item.revisions[0].field).toBe('due');
    expect(item.revisions[0].by).toBe('Priya');
    expect(item.revisions[0].msgId).toBe(2);
    expect(new Date(item.due!).getDate()).toBe(14);
  });

  it('produces NO revision when a later update message is ambiguous between two items', () => {
    const t1 = new Date(2025, 2, 10, 9, 0).getTime();
    const t2 = new Date(2025, 2, 10, 10, 0).getTime();
    const t3 = new Date(2025, 2, 10, 12, 0).getTime();

    const messages = [
      {
        id: 1,
        ts: t1,
        sender: 'Priya',
        text: 'Please send the client deck tomorrow.',
        isSystem: false,
      },
      {
        id: 2,
        ts: t2,
        sender: 'Priya',
        text: 'Please review the client deck tomorrow.',
        isSystem: false,
      },
      {
        id: 3,
        ts: t3,
        sender: 'Kabir',
        text: 'The client deck is done.',
        isSystem: false,
      },
    ];

    // Provide two distinct AI items sharing "client deck" so msg #3 is equally close to both
    const initialItems: LedgerItem[] = [
      {
        id: 'ai-1',
        kind: 'task',
        title: 'Send client deck Alpha',
        owner: 'Rohan',
        status: 'open',
        receipts: [{ msgId: 1, quote: 'send the client deck' }],
        revisions: [],
        fromUnread: true,
        changedWhileAway: false,
        onMe: true,
        lane: 'fyi',
        score: 0,
        reasons: [],
        source: 'ai',
      },
      {
        id: 'ai-2',
        kind: 'task',
        title: 'Audit client deck Beta',
        owner: 'Rohan',
        status: 'open',
        receipts: [{ msgId: 2, quote: 'review the client deck' }],
        revisions: [],
        fromUnread: true,
        changedWhileAway: false,
        onMe: true,
        lane: 'fyi',
        score: 0,
        reasons: [],
        source: 'ai',
      },
    ];

    const reconciled = reconcileLedger(
      initialItems,
      messages,
      ['Priya', 'Kabir', 'Rohan'],
      t1,
      'Rohan',
      [],
      false
    );

    expect(reconciled).toHaveLength(2);
    expect(reconciled[0].revisions).toHaveLength(0);
    expect(reconciled[1].revisions).toHaveLength(0);
  });
});

describe('6. Scope Filtering', () => {
  it('excludes items older than last-read time unless they changed while away or are still open and on me', () => {
    const oldTs = new Date(2025, 2, 10, 8, 0).getTime();
    const lastReadTs = new Date(2025, 2, 10, 12, 0).getTime();
    const unreadTs = new Date(2025, 2, 10, 14, 0).getTime();

    const messages = [
      {
        id: 1,
        ts: oldTs,
        sender: 'Priya',
        text: 'Kabir please submit the vendor form tomorrow.',
        isSystem: false,
      },
      {
        id: 2,
        ts: oldTs + 1000,
        sender: 'Priya',
        text: 'Rohan please submit the security report tomorrow.',
        isSystem: false,
      },
      {
        id: 3,
        ts: oldTs + 2000,
        sender: 'Priya',
        text: 'Meera please submit the travel invoice tomorrow.',
        isSystem: false,
      },
      {
        id: 4,
        ts: unreadTs,
        sender: 'Meera',
        text: 'Travel invoice submitted and done.',
        isSystem: false,
      },
    ];

    // User is Rohan.
    // Msg #1 (for Kabir, old, unchanged) -> excluded!
    // Msg #2 (for Rohan, old, still open and onMe) -> included!
    // Msg #3 (for Meera, old, but changed in Msg #4 during unread) -> included!
    const reconciled = reconcileLedger(
      [],
      messages,
      ['Priya', 'Kabir', 'Rohan', 'Meera'],
      lastReadTs,
      'Rohan',
      []
    );

    const receiptFirstIds = reconciled.map((i) => i.receipts[0].msgId);
    expect(receiptFirstIds).not.toContain(1);
    expect(receiptFirstIds).toContain(2);
    expect(receiptFirstIds).toContain(3);
  });
});

describe('7. Prioritization & Catch-up Brief', () => {
  it('orders urgent open items into "now", puts done/cancelled at the bottom, and builds a deterministic brief', () => {
    const nowTs = new Date(2025, 2, 10, 12, 0).getTime();
    const dueIn2h = nowTs + 2 * 60 * 60 * 1000;

    const rawItems: LedgerItem[] = [
      {
        id: 'done-1',
        kind: 'task',
        title: 'Completed task',
        owner: 'Rohan',
        due: dueIn2h,
        status: 'done',
        receipts: [{ msgId: 1, quote: 'Completed task' }],
        revisions: [],
        fromUnread: true,
        changedWhileAway: true,
        onMe: true,
        lane: 'fyi',
        score: 0,
        reasons: [],
        source: 'rules',
      },
      {
        id: 'urgent-1',
        kind: 'deadline',
        title: 'Ship release notes',
        owner: 'Rohan',
        due: dueIn2h,
        status: 'open',
        receipts: [{ msgId: 2, quote: 'Ship release notes' }],
        revisions: [],
        fromUnread: true,
        changedWhileAway: false,
        onMe: true,
        lane: 'fyi',
        score: 0,
        reasons: [],
        source: 'ai',
      },
    ];

    const msgs = [
      { id: 1, ts: nowTs - 1000, sender: 'Priya', text: 'Completed task', isSystem: false },
      { id: 2, ts: nowTs, sender: 'Priya', text: 'Ship release notes', isSystem: false },
    ];

    const prioritized = prioritizeItems(rawItems, msgs, nowTs);
    expect(prioritized[0].id).toBe('urgent-1');
    expect(prioritized[0].lane).toBe('now');
    expect(prioritized[1].id).toBe('done-1');

    const brief = buildCatchUpBrief(prioritized, msgs);
    expect(brief.isEmpty).toBe(false);
    expect(brief.topNowItems[0].title).toBe('Ship release notes');
    expect(brief.changedWhileAwayCount).toBe(1);

    const emptyBrief = buildCatchUpBrief([], msgs);
    expect(emptyBrief.isEmpty).toBe(true);
    expect(emptyBrief.emptyText).toBe('Nothing needs you in this part of the chat.');
  });
});

describe('8. End-to-End Pipeline with Test-Only Fake Engine & Codebase Hygiene Check', () => {
  it('runs full pipeline progressively with fake engine, verifying quotes and reconciling revisions', async () => {
    const rawChat = [
      '10/03/25, 10:00 am - Priya: @Rohan please send the Q1 pitch deck by tomorrow.',
      '10/03/25, 11:30 am - Priya: Actually Q1 pitch deck postponed to 13 March.',
    ].join('\n');

    const parsed = parseWhatsAppText(rawChat);
    const chunked = buildScopedWindows(parsed.messages, parsed.messages[0].ts);
    expect(chunked.cappedWindows.length).toBeGreaterThan(0);

    const fakeEngine: LLMEngine = {
      async load() {
        // no-op
      },
      async generateJSON(): Promise<ExtractedWindowResponse> {
        return {
          items: [
            {
              kind: 'deadline',
              title: 'Send Q1 pitch deck',
              owner: 'Rohan',
              due_text: 'tomorrow',
              evidence: [{ id: 1, quote: 'please send the Q1 pitch deck by tomorrow' }],
            },
            {
              kind: 'task',
              title: 'Unverified hallucination',
              owner: 'Rohan',
              due_text: null,
              evidence: [{ id: 1, quote: 'completely invented quote string' }],
            },
          ],
        };
      },
      interrupt() {
        // no-op
      },
    };

    const snapshot = await runPipeline({
      allMessages: parsed.messages,
      allParticipants: parsed.senders,
      lastReadTs: parsed.messages[0].ts,
      userName: 'Rohan',
      nicknames: [],
      mode: 'ai',
      llmEngine: fakeEngine,
    });

    expect(snapshot.isComplete).toBe(true);
    expect(snapshot.rejectedByVerifierCount).toBe(1);
    expect(snapshot.items).toHaveLength(1);
    expect(snapshot.items[0].title).toBe('Send Q1 pitch deck');
    expect(snapshot.items[0].source).toBe('ai');
    expect(snapshot.items[0].revisions).toHaveLength(1);
    expect(new Date(snapshot.items[0].due!).getDate()).toBe(13);
  });

  it('verifies production app code never imports from *.test.ts files or uses dangerouslySetInnerHTML', () => {
    const srcDir = path.resolve(__dirname, '..');

    function collectSourceFiles(dir: string): string[] {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const files: string[] = [];
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          files.push(...collectSourceFiles(fullPath));
        } else if (
          (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) &&
          !entry.name.endsWith('.test.ts') &&
          !entry.name.endsWith('.test.tsx')
        ) {
          files.push(fullPath);
        }
      }
      return files;
    }

    const prodFiles = collectSourceFiles(srcDir);
    expect(prodFiles.length).toBeGreaterThan(5);

    for (const file of prodFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      expect(content).not.toMatch(/from\s+['"][^'"]*\.test['"]/);
      expect(content).not.toMatch(/import\s*\(\s*['"][^'"]*\.test['"]\s*\)/);
      expect(content).not.toContain('dangerouslySetInnerHTML');
    }
  });
});

describe('9. High-Impact Action Features: Calendar (.ics), Draft Reply, and Markdown Export', () => {
  const sampleDueTs = new Date(2025, 2, 16, 17, 0, 0).getTime();

  const sampleTaskItem: LedgerItem = {
    id: 'task-cal-1',
    kind: 'deadline',
    title: 'Submit Q1 Budget, Forecast; & Notes',
    owner: 'Rohan',
    due: sampleDueTs,
    status: 'open',
    receipts: [{ msgId: 10, quote: 'Submit Q1 Budget by 16 March 5pm' }],
    revisions: [
      {
        msgId: 12,
        by: 'Priya',
        field: 'due',
        from: '15 Mar 17:00',
        to: '16 Mar 17:00',
      },
    ],
    fromUnread: true,
    changedWhileAway: true,
    onMe: true,
    lane: 'now',
    score: 95,
    reasons: ['Assigned to you', 'Due in 5h'],
    source: 'rules',
  };

  it('validates calendar eligibility and generates RFC 5545 .ics content without raw chat messages', () => {
    expect(hasValidCalendarDueDate(sampleTaskItem)).toBe(true);
    expect(hasValidCalendarDueDate({ ...sampleTaskItem, due: undefined })).toBe(false);
    expect(hasValidCalendarDueDate({ ...sampleTaskItem, status: 'done' })).toBe(false);

    expect(escapeIcsText('Hello, world; line1\nline2')).toBe('Hello\\, world\\; line1\\nline2');

    const ics = generateIcsContent(sampleTaskItem, sampleDueTs);
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('SUMMARY:Submit Q1 Budget\\, Forecast\\; & Notes');
    expect(ics).toContain('DESCRIPTION:Type: deadline\\nOwner: Rohan');
    // Must never leak transcript quotes
    expect(ics).not.toContain('Submit Q1 Budget by 16 March 5pm');
    expect(ics).toContain('END:VEVENT');
    expect(ics).toContain('END:VCALENDAR');

    const gcalUrl = buildGoogleCalendarUrl(sampleTaskItem);
    expect(gcalUrl).toContain('https://calendar.google.com/calendar/render?');
    expect(gcalUrl).not.toContain('Submit+Q1+Budget+by+16+March+5pm');
  });

  it('generates safe, non-invented local reply drafts for questions and tasks', () => {
    const questionItem: LedgerItem = {
      ...sampleTaskItem,
      id: 'q-1',
      kind: 'question',
      title: 'Can you confirm the staging deploy window?',
      receipts: [{ msgId: 10, quote: 'Can you confirm the staging deploy window?' }],
    };

    const msgs = [
      {
        id: 10,
        ts: sampleDueTs - 7200_000,
        sender: 'Priya',
        text: '@Rohan Can you confirm the staging deploy window?',
        isSystem: false,
      },
    ];

    expect(canDraftReply(questionItem)).toBe(true);
    expect(canDraftReply({ ...questionItem, status: 'done' })).toBe(false);

    const draft = generateDraftReply(questionItem, msgs);
    expect(draft.isGenericTemplate).toBe(false);
    expect(draft.recipientSender).toBe('Priya');
    expect(draft.draftText).toContain('Hi Priya,');
    expect(draft.draftText).toContain('Can you confirm the staging deploy window?');

    // Fallback when context is missing
    const fallbackDraft = generateDraftReply({ ...questionItem, title: 'Hi' }, []);
    expect(fallbackDraft.isGenericTemplate).toBe(true);
  });

  it('formats the Catch-Up Brief as clean Markdown with open tasks, questions, and revisions', () => {
    const questionItem: LedgerItem = {
      ...sampleTaskItem,
      id: 'q-2',
      kind: 'question',
      title: 'Are the API keys rotated?',
      revisions: [],
      changedWhileAway: false,
      due: undefined,
    };
    const doneItem: LedgerItem = {
      ...sampleTaskItem,
      id: 'done-2',
      kind: 'task',
      title: 'Old finished task',
      status: 'done',
      revisions: [],
      changedWhileAway: false,
    };

    const msgs = [
      {
        id: 10,
        ts: sampleDueTs - 7200_000,
        sender: 'Priya',
        text: 'Submit Q1 Budget by 16 March 5pm',
        isSystem: false,
      },
    ];

    const allItems = [sampleTaskItem, questionItem, doneItem];
    const brief = buildCatchUpBrief(allItems, msgs);
    const md = formatBriefAsMarkdown(brief, allItems);

    expect(md).toContain('# Catch-Up Brief');
    expect(md).toContain('## Open Tasks & Deadlines');
    expect(md).toContain('**Submit Q1 Budget, Forecast; & Notes**');
    expect(md).toContain('## Unanswered Questions');
    expect(md).toContain('**Are the API keys rotated?**');
    expect(md).toContain('## Recent Changes');
    expect(md).toContain('~15 Mar 17:00~ → **16 Mar 17:00** (by Priya)');
    // Completed items must not appear under Open Tasks & Deadlines
    expect(md).not.toContain('Old finished task');
  });
});

