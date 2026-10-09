import { create } from 'zustand';
import { CatchUpBrief, LedgerItem, Msg } from '../domain/types';
import { WebLLMBrowserEngine } from '../engine/llm/engine';
import {
  ModelTier,
  ResolvedModelOption,
  resolveModelOptions,
  selectRuntimeModelTier,
} from '../engine/llm/select';
import { parseWhatsAppText, WhatsAppParseError } from '../engine/parser/whatsapp';
import { DEFAULT_MAX_WINDOWS } from '../engine/pipeline/chunk';
import { runPipeline, ScanMode, ScanSnapshot } from '../engine/pipeline/run';

const LS_NAME_KEY = 'receipts.userName';
const LS_NICKNAMES_KEY = 'receipts.nicknames';

function loadStoredProfile(): { userName: string; nicknames: string[] } {
  try {
    const rawName = localStorage.getItem(LS_NAME_KEY) ?? '';
    const rawNicks = localStorage.getItem(LS_NICKNAMES_KEY);
    const parsedNicks: unknown = rawNicks ? JSON.parse(rawNicks) : [];
    const nicknames = Array.isArray(parsedNicks)
      ? parsedNicks.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      : [];
    return { userName: rawName, nicknames };
  } catch {
    return { userName: '', nicknames: [] };
  }
}

function saveStoredProfile(userName: string, nicknames: string[]): void {
  try {
    localStorage.setItem(LS_NAME_KEY, userName);
    localStorage.setItem(LS_NICKNAMES_KEY, JSON.stringify(nicknames));
  } catch {
    // Ignore storage quota or private mode errors
  }
}

function clearStoredProfile(): void {
  try {
    localStorage.removeItem(LS_NAME_KEY);
    localStorage.removeItem(LS_NICKNAMES_KEY);
  } catch {
    // Ignore storage errors
  }
}

export type StepId = 1 | 2 | 3;

export type LastReadPreset = 'since_my_last' | 'last_6h' | 'yesterday' | 'custom';

export type EngineChipState =
  | 'rules_only'
  | 'load_ready'
  | 'downloading'
  | 'local_ai_ready'
  | 'ai_unavailable';

export type LedgerFilterKey = 'onMe' | 'changed' | 'questions' | 'done';

const initialModelOptions = resolveModelOptions();
const initialProfile = loadStoredProfile();

let activeBrowserEngine: WebLLMBrowserEngine | null = null;
let activeScanAbortController: AbortController | null = null;

export interface AppState {
  step: StepId;
  // Chat data (never persisted)
  messages: Msg[];
  senders: string[];
  parseError: string | null;
  importedFileName: string | null;

  // User profile (only name & nicknames persisted in localStorage)
  userName: string;
  nicknames: string[];
  lastReadPreset: LastReadPreset;
  lastReadTs: number;

  // Engine state
  engineState: EngineChipState;
  selectedTier: ModelTier;
  fullOption: ResolvedModelOption;
  liteOption: ResolvedModelOption;
  downloadProgress: number; // 0..100
  downloadStatusText: string;
  engineNotice: string | null;

  // Scan & Ledger state
  isScanning: boolean;
  scanModeUsed: ScanMode | null;
  scanSnapshot: ScanSnapshot | null;
  maxWindows: number;
  activeFilters: Record<LedgerFilterKey, boolean>;

  // Receipts drawer state
  activeReceiptItem: LedgerItem | null;
  activeReceiptTargetMsgId: number | null;

  // Verify privacy modal/panel state
  privacyPanelOpen: boolean;

  // Actions
  setStep: (step: StepId) => void;
  importChatText: (rawText: string, fileName?: string, byteSize?: number) => boolean;
  setUserName: (name: string) => void;
  addNickname: (nick: string) => void;
  removeNickname: (nick: string) => void;
  setLastReadPreset: (preset: LastReadPreset, customTimestamp?: number) => void;
  detectWebGPUAndSelectTier: () => Promise<void>;
  setSelectedTier: (tier: ModelTier) => void;
  loadAIModel: () => Promise<void>;
  startScan: (mode: ScanMode, customMaxWindows?: number) => Promise<void>;
  scanDeeper: () => Promise<void>;
  cancelScan: () => void;
  toggleFilter: (key: LedgerFilterKey) => void;
  openReceiptsDrawer: (item: LedgerItem, focusMsgId?: number) => void;
  closeReceiptsDrawer: () => void;
  setPrivacyPanelOpen: (open: boolean) => void;
  clearAllMyData: () => void;
}

function computePresetTimestamp(
  preset: LastReadPreset,
  messages: Msg[],
  userName: string,
  customTs?: number
): number {
  if (messages.length === 0) return 0;
  const minTs = messages[0].ts;
  const maxTs = messages[messages.length - 1].ts;

  if (preset === 'custom' && customTs !== undefined && Number.isFinite(customTs)) {
    return customTs;
  }

  if (preset === 'since_my_last') {
    const cleanUser = userName.trim().toLowerCase();
    if (cleanUser) {
      for (let i = messages.length - 1; i >= 0; i--) {
        if (!messages[i].isSystem && messages[i].sender.trim().toLowerCase() === cleanUser) {
          return messages[i].ts;
        }
      }
    }
    // If the user hasn't sent a message in this export, default to start of chat
    return minTs;
  }

  if (preset === 'last_6h') {
    return Math.max(minTs, maxTs - 6 * 60 * 60 * 1000);
  }

  if (preset === 'yesterday') {
    const latestDate = new Date(maxTs);
    const yesterdayStart = new Date(
      latestDate.getFullYear(),
      latestDate.getMonth(),
      latestDate.getDate() - 1,
      0,
      0,
      0,
      0
    ).getTime();
    return Math.max(minTs, yesterdayStart);
  }

  return minTs;
}

const emptyBrief: CatchUpBrief = {
  isEmpty: true,
  emptyText: 'Nothing needs you in this part of the chat.',
  unreadMessageCount: 0,
  timeSpanText: '',
  participantCount: 0,
  countsByKind: { task: 0, decision: 0, deadline: 0, question: 0 },
  topNowItems: [],
  changedWhileAwayCount: 0,
  summaryLines: ['Nothing needs you in this part of the chat.'],
};

export const useAppStore = create<AppState>((set, get) => ({
  step: 1,
  messages: [],
  senders: [],
  parseError: null,
  importedFileName: null,

  userName: initialProfile.userName,
  nicknames: initialProfile.nicknames,
  lastReadPreset: 'since_my_last',
  lastReadTs: 0,

  engineState: 'load_ready',
  selectedTier: 'full',
  fullOption: initialModelOptions.fullOption,
  liteOption: initialModelOptions.liteOption,
  downloadProgress: 0,
  downloadStatusText: '',
  engineNotice: null,

  isScanning: false,
  scanModeUsed: null,
  scanSnapshot: null,
  maxWindows: DEFAULT_MAX_WINDOWS,
  activeFilters: {
    onMe: false,
    changed: false,
    questions: false,
    done: false,
  },

  activeReceiptItem: null,
  activeReceiptTargetMsgId: null,
  privacyPanelOpen: false,

  setStep: (step) => set({ step }),

  importChatText: (rawText, fileName, byteSize) => {
    try {
      const parsed = parseWhatsAppText(rawText, byteSize);
      const state = get();

      // Match stored userName if present in senders, else pick first sender
      let matchedSender = state.userName;
      if (
        !matchedSender ||
        !parsed.senders.some((s) => s.toLowerCase() === matchedSender.toLowerCase())
      ) {
        matchedSender = parsed.senders[0] ?? '';
      }

      saveStoredProfile(matchedSender, state.nicknames);
      const lastReadTs = computePresetTimestamp(
        'since_my_last',
        parsed.messages,
        matchedSender
      );

      set({
        messages: parsed.messages,
        senders: parsed.senders,
        parseError: null,
        importedFileName: fileName ?? 'Pasted chat transcript',
        userName: matchedSender,
        lastReadPreset: 'since_my_last',
        lastReadTs,
        step: 2,
        scanSnapshot: null,
        maxWindows: DEFAULT_MAX_WINDOWS,
      });
      return true;
    } catch (err) {
      const message =
        err instanceof WhatsAppParseError
          ? err.message
          : 'Could not parse the chat text. Please verify it is an exported WhatsApp .txt file.';
      set({ parseError: message });
      return false;
    }
  },

  setUserName: (name) => {
    const state = get();
    saveStoredProfile(name, state.nicknames);
    const updatedLastRead =
      state.lastReadPreset === 'since_my_last'
        ? computePresetTimestamp('since_my_last', state.messages, name)
        : state.lastReadTs;
    set({ userName: name, lastReadTs: updatedLastRead });
  },

  addNickname: (nick) => {
    const clean = nick.trim().replace(/^@+/, '');
    if (!clean) return;
    const state = get();
    if (state.nicknames.some((n) => n.toLowerCase() === clean.toLowerCase())) return;
    const updated = [...state.nicknames, clean];
    saveStoredProfile(state.userName, updated);
    set({ nicknames: updated });
  },

  removeNickname: (nick) => {
    const state = get();
    const updated = state.nicknames.filter((n) => n !== nick);
    saveStoredProfile(state.userName, updated);
    set({ nicknames: updated });
  },

  setLastReadPreset: (preset, customTimestamp) => {
    const state = get();
    const computedTs = computePresetTimestamp(
      preset,
      state.messages,
      state.userName,
      customTimestamp
    );
    set({ lastReadPreset: preset, lastReadTs: computedTs });
  },

  detectWebGPUAndSelectTier: async () => {
    const selection = await selectRuntimeModelTier();
    if (!selection.webgpuAvailable || !selection.recommendedTier) {
      set({
        engineState: 'ai_unavailable',
        fullOption: selection.fullOption,
        liteOption: selection.liteOption,
        engineNotice: selection.reason,
      });
      return;
    }
    set({
      engineState: 'load_ready',
      selectedTier: selection.recommendedTier,
      fullOption: selection.fullOption,
      liteOption: selection.liteOption,
      engineNotice: null,
    });
  },

  setSelectedTier: (tier) => {
    const state = get();
    if (state.engineState === 'downloading') return;
    set({
      selectedTier: tier,
      engineState:
        state.engineState === 'ai_unavailable' ? 'ai_unavailable' : 'load_ready',
    });
  },

  loadAIModel: async () => {
    const state = get();
    if (state.engineState === 'downloading') return;

    set({
      engineState: 'downloading',
      downloadProgress: 0,
      downloadStatusText: 'Initializing local WebGPU model…',
      engineNotice: null,
    });

    try {
      const engine = new WebLLMBrowserEngine(state.selectedTier);
      await engine.load((report) => {
        const pct = Math.max(0, Math.min(100, Math.round(report.progress * 100)));
        set({
          downloadProgress: pct,
          downloadStatusText: report.text || `Downloading ${pct}%`,
        });
      });

      activeBrowserEngine = engine;
      set({
        engineState: 'local_ai_ready',
        selectedTier: engine.getActiveTier(),
        downloadProgress: 100,
        downloadStatusText: 'Local AI ready · works offline',
        engineNotice: engine.getFallbackNotice(),
      });
    } catch {
      activeBrowserEngine = null;
      set({
        engineState: 'ai_unavailable',
        downloadProgress: 0,
        downloadStatusText: '',
        engineNotice:
          'Local WebGPU model could not be loaded on this device. Using Rules-only mode.',
      });
    }
  },

  startScan: async (mode, customMaxWindows) => {
    const state = get();
    if (state.messages.length === 0) return;

    if (activeScanAbortController) {
      activeScanAbortController.abort();
    }
    const controller = new AbortController();
    activeScanAbortController = controller;

    const effectiveMaxWindows = customMaxWindows ?? state.maxWindows;
    const effectiveMode: ScanMode =
      mode === 'ai' && state.engineState === 'local_ai_ready' && activeBrowserEngine
        ? 'ai'
        : 'rules';

    set({
      step: 3,
      isScanning: true,
      scanModeUsed: effectiveMode,
      maxWindows: effectiveMaxWindows,
    });

    try {
      const finalSnap = await runPipeline({
        allMessages: state.messages,
        allParticipants: state.senders,
        lastReadTs: state.lastReadTs,
        userName: state.userName,
        nicknames: state.nicknames,
        mode: effectiveMode,
        llmEngine: effectiveMode === 'ai' ? activeBrowserEngine : null,
        maxWindows: effectiveMaxWindows,
        signal: controller.signal,
        onUpdate: (snapshot) => {
          set({
            scanSnapshot: snapshot,
            isScanning: !snapshot.isComplete,
          });
        },
      });

      set({
        scanSnapshot: finalSnap,
        isScanning: false,
      });
    } catch {
      set({
        isScanning: false,
        scanSnapshot: state.scanSnapshot ?? {
          items: [],
          brief: emptyBrief,
          messagesScanned: 0,
          unreadCount: 0,
          rejectedByVerifierCount: 0,
          currentWindow: 0,
          totalWindows: 0,
          statusText: 'Scan encountered an error',
          hasMoreWindows: false,
          totalUncappedWindows: 0,
          isComplete: true,
          cancelled: false,
        },
      });
    }
  },

  scanDeeper: async () => {
    const state = get();
    const nextCap = state.maxWindows + DEFAULT_MAX_WINDOWS;
    await state.startScan(state.scanModeUsed ?? 'rules', nextCap);
  },

  cancelScan: () => {
    if (activeScanAbortController) {
      activeScanAbortController.abort();
      activeScanAbortController = null;
    }
    activeBrowserEngine?.interrupt();
    set({ isScanning: false });
  },

  toggleFilter: (key) => {
    const state = get();
    set({
      activeFilters: {
        ...state.activeFilters,
        [key]: !state.activeFilters[key],
      },
    });
  },

  openReceiptsDrawer: (item, focusMsgId) => {
    const firstMsgId = focusMsgId ?? item.receipts[0]?.msgId ?? null;
    set({
      activeReceiptItem: item,
      activeReceiptTargetMsgId: firstMsgId,
    });
  },

  closeReceiptsDrawer: () => {
    set({
      activeReceiptItem: null,
      activeReceiptTargetMsgId: null,
    });
  },

  setPrivacyPanelOpen: (open) => set({ privacyPanelOpen: open }),

  clearAllMyData: () => {
    if (activeScanAbortController) {
      activeScanAbortController.abort();
      activeScanAbortController = null;
    }
    activeBrowserEngine?.interrupt();
    clearStoredProfile();
    set({
      step: 1,
      messages: [],
      senders: [],
      parseError: null,
      importedFileName: null,
      userName: '',
      nicknames: [],
      lastReadPreset: 'since_my_last',
      lastReadTs: 0,
      isScanning: false,
      scanModeUsed: null,
      scanSnapshot: null,
      maxWindows: DEFAULT_MAX_WINDOWS,
      activeFilters: {
        onMe: false,
        changed: false,
        questions: false,
        done: false,
      },
      activeReceiptItem: null,
      activeReceiptTargetMsgId: null,
    });
  },
}));
