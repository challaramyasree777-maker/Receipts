export type Msg = {
  id: number;
  ts: number;
  sender: string;
  text: string;
  isSystem: boolean;
};

export type Receipt = {
  msgId: number;
  quote: string;
};

export type Revision = {
  msgId: number;
  by: string;
  field: 'due' | 'owner' | 'status' | 'title';
  from: string;
  to: string;
};

export type LedgerItem = {
  id: string;
  kind: 'task' | 'decision' | 'deadline' | 'question';
  title: string;
  owner?: string;
  due?: number;
  status: 'open' | 'done' | 'cancelled';
  receipts: Receipt[];
  revisions: Revision[];
  fromUnread: boolean;
  changedWhileAway: boolean;
  onMe: boolean;
  lane: 'now' | 'soon' | 'fyi';
  score: number;
  reasons: string[];
  source: 'ai' | 'rules';
};

export type ExtractedEvidence = {
  id: number;
  quote: string;
};

export type ExtractedRawItem = {
  kind: 'task' | 'decision' | 'deadline' | 'question';
  title: string;
  owner: string | null;
  due_text: string | null;
  evidence: ExtractedEvidence[];
};

export type ExtractedWindowResponse = {
  items: ExtractedRawItem[];
};

export type CatchUpBrief = {
  isEmpty: boolean;
  emptyText: string;
  unreadMessageCount: number;
  timeSpanText: string;
  participantCount: number;
  countsByKind: {
    task: number;
    decision: number;
    deadline: number;
    question: number;
  };
  topNowItems: {
    id: string;
    title: string;
    due?: number;
    dueFormatted?: string;
  }[];
  changedWhileAwayCount: number;
  summaryLines: string[];
};
