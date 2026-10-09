import React from 'react';
import { Cpu, Download, CheckCircle2, AlertCircle } from 'lucide-react';
import { useAppStore } from '../../state/store';
import { ModelTier } from '../../engine/llm/select';

export function EngineStatusChip() {
  const {
    engineState,
    selectedTier,
    fullOption,
    liteOption,
    downloadProgress,
    engineNotice,
    setSelectedTier,
    loadAIModel,
  } = useAppStore();

  const activeOption = selectedTier === 'full' ? fullOption : liteOption;
  const sizeHint = activeOption.vramRequiredMB
    ? `~${(activeOption.vramRequiredMB / 1024).toFixed(1)} GB · cached after`
    : 'one-time download, cached after';

  const handleTierChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value as ModelTier;
    setSelectedTier(val);
  };

  return (
    <div className="engine-bar" role="region" aria-label="Local AI Engine Status">
      <Cpu size={14} color="var(--accent-primary)" aria-hidden="true" />
      <label
        htmlFor="model-tier-select"
        style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)' }}
      >
        Select Local AI Model Tier
      </label>
      <select
        id="model-tier-select"
        className="engine-select"
        value={selectedTier}
        onChange={handleTierChange}
        disabled={engineState === 'downloading' || engineState === 'ai_unavailable'}
        title={engineNotice ?? 'Choose Full (Gemma 2 2B) or Lite (Llama 3.2 1B)'}
      >
        <option value="full">Full · Gemma 2 2B</option>
        <option value="lite">Lite · Llama 3.2 1B</option>
      </select>

      {engineState === 'rules_only' && (
        <span className="engine-pill-badge rules">Rules-only</span>
      )}

      {engineState === 'load_ready' && (
        <button
          type="button"
          className="btn btn-primary btn-pill"
          style={{ padding: '4px 12px', minHeight: '28px', fontSize: '0.75rem' }}
          onClick={() => void loadAIModel()}
        >
          <Download size={13} aria-hidden="true" />
          <span>Load AI model ({sizeHint})</span>
        </button>
      )}

      {engineState === 'downloading' && (
        <span className="engine-pill-badge downloading" aria-live="polite">
          Downloading {downloadProgress}%
        </span>
      )}

      {engineState === 'local_ai_ready' && (
        <span className="engine-pill-badge ready" aria-live="polite">
          <CheckCircle2 size={13} aria-hidden="true" />
          <span>Local AI ready · works offline</span>
        </span>
      )}

      {engineState === 'ai_unavailable' && (
        <span
          className="engine-pill-badge rules"
          aria-live="polite"
          title={engineNotice ?? undefined}
        >
          <AlertCircle size={13} aria-hidden="true" />
          <span>AI unavailable, using Rules-only</span>
        </span>
      )}
    </div>
  );
}
