import { CatchUpBrief, LedgerItem, Msg } from '../../domain/types';
import { LLMEngine } from '../llm/engine';
import { buildCatchUpBrief } from './brief';
import { buildScopedWindows, DEFAULT_MAX_WINDOWS } from './chunk';
import { prioritizeItems } from './prioritize';
import { reconcileLedger } from './reconcile';
import { verifyExtractedItems } from './verify';

export type ScanMode = 'rules' | 'ai';

export type ScanSnapshot = {
  items: LedgerItem[];
  brief: CatchUpBrief;
  messagesScanned: number;
  unreadCount: number;
  rejectedByVerifierCount: number;
  currentWindow: number;
  totalWindows: number;
  statusText: string;
  hasMoreWindows: boolean;
  totalUncappedWindows: number;
  isComplete: boolean;
  cancelled: boolean;
};

export type RunPipelineOptions = {
  allMessages: Msg[];
  allParticipants: string[];
  lastReadTs: number;
  userName: string;
  nicknames: string[];
  mode: ScanMode;
  llmEngine?: LLMEngine | null;
  maxWindows?: number;
  referenceNowTs?: number;
  signal?: AbortSignal;
  onUpdate?: (snapshot: ScanSnapshot) => void;
};

export async function runPipeline(options: RunPipelineOptions): Promise<ScanSnapshot> {
  const {
    allMessages,
    allParticipants,
    lastReadTs,
    userName,
    nicknames,
    mode,
    llmEngine,
    maxWindows = DEFAULT_MAX_WINDOWS,
    referenceNowTs,
    signal,
    onUpdate,
  } = options;

  const chunked = buildScopedWindows(allMessages, lastReadTs, maxWindows);
  const {
    scopedMessages,
    unreadMessages,
    cappedWindows,
    hasMoreWindows,
    totalUncappedWindows,
  } = chunked;

  const totalWindows = cappedWindows.length;
  let totalRejected = 0;
  const accumulatedVerifiedAiItems: LedgerItem[] = [];

  const computeCurrentSnapshot = (
    currentWindow: number,
    statusText: string,
    isComplete: boolean,
    cancelled: boolean
  ): ScanSnapshot => {
    const reconciled = reconcileLedger(
      accumulatedVerifiedAiItems,
      scopedMessages,
      allParticipants,
      lastReadTs,
      userName,
      nicknames,
      true // Always include high-precision Rules items alongside verified AI items
    );
    const prioritized = prioritizeItems(reconciled, scopedMessages, referenceNowTs);
    const brief = buildCatchUpBrief(prioritized, unreadMessages);

    return {
      items: prioritized,
      brief,
      messagesScanned: scopedMessages.filter((m) => !m.isSystem).length,
      unreadCount: unreadMessages.filter((m) => !m.isSystem).length,
      rejectedByVerifierCount: totalRejected,
      currentWindow,
      totalWindows,
      statusText,
      hasMoreWindows,
      totalUncappedWindows,
      isComplete,
      cancelled,
    };
  };

  // Rules-only mode or no windows
  if (mode === 'rules' || !llmEngine || totalWindows === 0) {
    const finalSnapshot = computeCurrentSnapshot(
      totalWindows,
      'Rules scan complete',
      true,
      false
    );
    onUpdate?.(finalSnapshot);
    return finalSnapshot;
  }

  // Emit initial rules baseline before Window 1 finishes
  onUpdate?.(
    computeCurrentSnapshot(
      0,
      `Reading window 1 of ${totalWindows}`,
      false,
      false
    )
  );

  for (let i = 0; i < totalWindows; i++) {
    if (signal?.aborted) {
      llmEngine.interrupt();
      const cancelledSnap = computeCurrentSnapshot(
        i,
        `Scan stopped at window ${i} of ${totalWindows}`,
        true,
        true
      );
      onUpdate?.(cancelledSnap);
      return cancelledSnap;
    }

    const win = cappedWindows[i];
    const windowNum = i + 1;

    onUpdate?.(
      computeCurrentSnapshot(
        windowNum,
        `Reading window ${windowNum} of ${totalWindows}`,
        false,
        false
      )
    );

    const extracted = await llmEngine.generateJSON(win.formattedText);

    if (signal?.aborted) {
      llmEngine.interrupt();
      const cancelledSnap = computeCurrentSnapshot(
        windowNum,
        `Scan stopped at window ${windowNum} of ${totalWindows}`,
        true,
        true
      );
      onUpdate?.(cancelledSnap);
      return cancelledSnap;
    }

    const verification = verifyExtractedItems(
      extracted.items,
      win.messages,
      allParticipants,
      lastReadTs,
      userName,
      nicknames
    );

    totalRejected += verification.rejectedCount;
    accumulatedVerifiedAiItems.push(...verification.verifiedItems);

    const isLast = windowNum === totalWindows;
    const progressSnap = computeCurrentSnapshot(
      windowNum,
      isLast ? 'Local AI scan complete' : `Reading window ${windowNum + 1} of ${totalWindows}`,
      isLast,
      false
    );
    onUpdate?.(progressSnap);
  }

  return computeCurrentSnapshot(totalWindows, 'Local AI scan complete', true, false);
}
