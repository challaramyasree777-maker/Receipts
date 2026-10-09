import { prebuiltAppConfig, ModelRecord } from '@mlc-ai/web-llm';

export type ModelTier = 'full' | 'lite';

export const PREFERRED_FULL_MODEL_ID = 'gemma-2-2b-it-q4f16_1-MLC';
export const PREFERRED_LITE_MODEL_ID = 'Llama-3.2-1B-Instruct-q4f16_1-MLC';

export type ResolvedModelOption = {
  tier: ModelTier;
  modelId: string;
  vramRequiredMB?: number;
  bufferSizeRequiredBytes?: number;
  displayLabel: string;
};

export type RuntimeSelectionResult = {
  webgpuAvailable: boolean;
  recommendedTier: ModelTier | null;
  fullOption: ResolvedModelOption;
  liteOption: ResolvedModelOption;
  adapterMaxBufferSize?: number;
  reason: string;
};

function findClosestModelRecord(
  modelList: ModelRecord[],
  preferredId: string,
  fallbackSearchTokens: string[]
): ModelRecord | undefined {
  // 1. Exact match
  const exact = modelList.find((m) => m.model_id === preferredId);
  if (exact) return exact;

  // 2. Case-insensitive match
  const lowerPref = preferredId.toLowerCase();
  const ci = modelList.find((m) => m.model_id.toLowerCase() === lowerPref);
  if (ci) return ci;

  // 3. Token match
  const candidates = modelList.filter((m) => {
    const idLower = m.model_id.toLowerCase();
    return fallbackSearchTokens.every((tok) => idLower.includes(tok.toLowerCase()));
  });

  if (candidates.length > 0) {
    // Prefer q4f16_1
    const q4f16 = candidates.find((c) => c.model_id.includes('q4f16_1'));
    return q4f16 ?? candidates[0];
  }

  return modelList[0];
}

export function resolveModelOptions(
  modelList: ModelRecord[] = prebuiltAppConfig.model_list
): { fullOption: ResolvedModelOption; liteOption: ResolvedModelOption } {
  const fullRecord = findClosestModelRecord(modelList, PREFERRED_FULL_MODEL_ID, ['gemma-2-2b', 'it']);
  const liteRecord = findClosestModelRecord(modelList, PREFERRED_LITE_MODEL_ID, ['llama-3.2-1b', 'instruct']);

  const fullId = fullRecord?.model_id ?? PREFERRED_FULL_MODEL_ID;
  const liteId = liteRecord?.model_id ?? PREFERRED_LITE_MODEL_ID;

  const formatSize = (vramMB?: number): string => {
    if (!vramMB || vramMB <= 0) return 'one-time download, cached after';
    if (vramMB >= 1024) {
      return `~${(vramMB / 1024).toFixed(1)} GB VRAM`;
    }
    return `~${Math.round(vramMB)} MB VRAM`;
  };

  return {
    fullOption: {
      tier: 'full',
      modelId: fullId,
      vramRequiredMB: fullRecord?.vram_required_MB,
      bufferSizeRequiredBytes: fullRecord?.buffer_size_required_bytes,
      displayLabel: `Full (Gemma 2 2B · ${formatSize(fullRecord?.vram_required_MB)})`,
    },
    liteOption: {
      tier: 'lite',
      modelId: liteId,
      vramRequiredMB: liteRecord?.vram_required_MB,
      bufferSizeRequiredBytes: liteRecord?.buffer_size_required_bytes,
      displayLabel: `Lite (Llama 3.2 1B · ${formatSize(liteRecord?.vram_required_MB)})`,
    },
  };
}

interface GPUAdapterLike {
  limits?: {
    maxStorageBufferBindingSize?: number;
    maxBufferSize?: number;
  };
}

interface NavigatorWithGPU {
  gpu?: {
    requestAdapter: () => Promise<GPUAdapterLike | null>;
  };
}

/**
 * Chooses Full or Lite at runtime from navigator.gpu.requestAdapter() limits
 * and the model record's own memory requirement (vram_required_MB / buffer_size_required_bytes).
 * If WebGPU is missing, returns webgpuAvailable: false (Rules-only).
 */
export async function selectRuntimeModelTier(
  modelList: ModelRecord[] = prebuiltAppConfig.model_list
): Promise<RuntimeSelectionResult> {
  const { fullOption, liteOption } = resolveModelOptions(modelList);

  if (typeof navigator === 'undefined') {
    return {
      webgpuAvailable: false,
      recommendedTier: null,
      fullOption,
      liteOption,
      reason: 'Navigator unavailable; using Rules-only mode.',
    };
  }

  const nav = navigator as unknown as NavigatorWithGPU;
  if (!nav.gpu || typeof nav.gpu.requestAdapter !== 'function') {
    return {
      webgpuAvailable: false,
      recommendedTier: null,
      fullOption,
      liteOption,
      reason: 'WebGPU is not supported in this browser; using Rules-only mode.',
    };
  }

  try {
    const adapter = await nav.gpu.requestAdapter();
    if (!adapter) {
      return {
        webgpuAvailable: false,
        recommendedTier: null,
        fullOption,
        liteOption,
        reason: 'No compatible WebGPU adapter found; using Rules-only mode.',
      };
    }

    const maxStorageBinding = adapter.limits?.maxStorageBufferBindingSize ?? 0;
    const maxBufferSize = adapter.limits?.maxBufferSize ?? 0;
    const effectiveBufferLimit = Math.max(maxStorageBinding, maxBufferSize);

    const fullRequiredBuffer = fullOption.bufferSizeRequiredBytes ?? 0;
    const fullRequiredVramMB = fullOption.vramRequiredMB ?? 2048;

    // Check adapter buffer limit against model record's buffer_size_required_bytes and vram_required_MB
    if (fullRequiredBuffer > 0 && effectiveBufferLimit > 0 && effectiveBufferLimit < fullRequiredBuffer) {
      return {
        webgpuAvailable: true,
        recommendedTier: 'lite',
        fullOption,
        liteOption,
        adapterMaxBufferSize: effectiveBufferLimit,
        reason: 'GPU storage buffer limit is smaller than Full model requirement; selected Lite.',
      };
    }

    // Also compare maxBufferSize in MB against vram_required_MB when available
    const maxBufferMB = maxBufferSize > 0 ? maxBufferSize / (1024 * 1024) : 0;
    if (maxBufferMB > 0 && maxBufferMB < fullRequiredVramMB * 0.5) {
      return {
        webgpuAvailable: true,
        recommendedTier: 'lite',
        fullOption,
        liteOption,
        adapterMaxBufferSize: effectiveBufferLimit,
        reason: 'GPU max buffer size indicates constrained VRAM; selected Lite.',
      };
    }

    return {
      webgpuAvailable: true,
      recommendedTier: 'full',
      fullOption,
      liteOption,
      adapterMaxBufferSize: effectiveBufferLimit,
      reason: 'WebGPU adapter meets Full model memory requirements.',
    };
  } catch {
    return {
      webgpuAvailable: false,
      recommendedTier: null,
      fullOption,
      liteOption,
      reason: 'Failed to initialize WebGPU adapter; using Rules-only mode.',
    };
  }
}
