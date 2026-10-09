import React, { useEffect } from 'react';
import { Trash2, ShieldCheck, Check, FileCheck2, Lock } from 'lucide-react';
import { useAppStore } from './state/store';
import { EngineStatusChip } from './features/engine-status/EngineStatusChip';
import { VerifyPrivacyPanel } from './features/privacy/VerifyPrivacyPanel';
import { ImportStep } from './features/import/ImportStep';
import { YouStep } from './features/you/YouStep';
import { LedgerStep } from './features/ledger/LedgerStep';
import { ReceiptsDrawer } from './features/receipts/ReceiptsDrawer';

export default function App() {
  const {
    step,
    messages,
    scanSnapshot,
    privacyPanelOpen,
    setStep,
    setPrivacyPanelOpen,
    clearAllMyData,
    detectWebGPUAndSelectTier,
  } = useAppStore();

  useEffect(() => {
    void detectWebGPUAndSelectTier();
  }, [detectWebGPUAndSelectTier]);

  const hasChatLoaded = messages.length > 0;
  const hasScanned = scanSnapshot !== null;

  const isStep1Completed = hasChatLoaded && step > 1;
  const isStep2Completed = hasChatLoaded && hasScanned && step > 2;

  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>

      <header className="top-header">
        <div className="top-header-inner">
          {/* Zone 1: Brand + Segmented Progress Stepper */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-5)', flexWrap: 'wrap' }}>
            <div className="brand-group">
              <span className="brand-mark" aria-hidden="true">
                <FileCheck2 size={17} />
              </span>
              <div className="brand-text-stack">
                <span className="brand-title">Receipts</span>
                <span className="brand-subtitle">Local-first chat ledger</span>
              </div>
            </div>

            <nav aria-label="Catch-up workflow steps">
              <ol className="stepper-nav">
                <li>
                  <button
                    type="button"
                    className={`step-btn ${step === 1 ? 'active' : ''} ${isStep1Completed ? 'completed' : ''}`}
                    onClick={() => setStep(1)}
                    aria-current={step === 1 ? 'step' : undefined}
                  >
                    <span className="step-indicator" aria-hidden="true">
                      {isStep1Completed ? <Check size={12} strokeWidth={3} /> : '1'}
                    </span>
                    <span>Import</span>
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    className={`step-btn ${step === 2 ? 'active' : ''} ${isStep2Completed ? 'completed' : ''}`}
                    disabled={!hasChatLoaded}
                    onClick={() => setStep(2)}
                    aria-current={step === 2 ? 'step' : undefined}
                  >
                    <span className="step-indicator" aria-hidden="true">
                      {isStep2Completed ? <Check size={12} strokeWidth={3} /> : '2'}
                    </span>
                    <span>You</span>
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    className={`step-btn ${step === 3 ? 'active' : ''}`}
                    disabled={!hasChatLoaded || !hasScanned}
                    onClick={() => setStep(3)}
                    aria-current={step === 3 ? 'step' : undefined}
                  >
                    <span className="step-indicator" aria-hidden="true">
                      3
                    </span>
                    <span>Ledger</span>
                  </button>
                </li>
              </ol>
            </nav>
          </div>

          {/* Zone 2: Privacy Trust Indicator + Compact Engine Toolbar + Privacy & Clear Data */}
          <div className="header-actions">
            <span
              className="privacy-trust-pill"
              title="All chat parsing, rules matching, and WebLLM inference run locally in your browser tab"
            >
              <Lock size={12} aria-hidden="true" />
              <span>On-device processing · Private</span>
            </span>

            <EngineStatusChip />

            <button
              type="button"
              className="btn btn-ghost btn-pill"
              style={{ padding: '6px 12px', minHeight: '34px', fontSize: '0.78125rem' }}
              onClick={() => setPrivacyPanelOpen(!privacyPanelOpen)}
              aria-expanded={privacyPanelOpen}
            >
              <ShieldCheck size={15} color="var(--accent-primary)" aria-hidden="true" />
              <span>Verify privacy</span>
            </button>

            <button
              type="button"
              className="btn btn-danger-ghost"
              style={{ minHeight: '34px' }}
              onClick={clearAllMyData}
              title="Clear loaded chat, ledger results, and saved name/nicknames from localStorage"
            >
              <Trash2 size={14} aria-hidden="true" />
              <span>Clear my data</span>
            </button>
          </div>
        </div>
      </header>

      <main id="main-content" className="main-container">
        <VerifyPrivacyPanel />

        {step === 1 && <ImportStep />}
        {step === 2 && <YouStep />}
        {step === 3 && <LedgerStep />}
      </main>

      <ReceiptsDrawer />

      <footer className="app-footer">
        <div className="app-footer-inner">
          <span>
            100% client-side processing · Conversations, receipts, and summaries never leave your device.
          </span>
          <span>
            Best in Chrome or Edge on desktop (WebGPU)
          </span>
        </div>
      </footer>
    </div>
  );
}
