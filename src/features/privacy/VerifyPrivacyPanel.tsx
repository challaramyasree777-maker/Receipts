import React from 'react';
import { ShieldCheck, X } from 'lucide-react';
import { useAppStore } from '../../state/store';

export function VerifyPrivacyPanel() {
  const { privacyPanelOpen, setPrivacyPanelOpen } = useAppStore();

  if (!privacyPanelOpen) return null;

  return (
    <section
      className="surface-card"
      style={{ marginBottom: 'var(--space-5)', borderColor: 'var(--accent-primary)' }}
      aria-labelledby="verify-privacy-heading"
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <ShieldCheck size={20} color="var(--accent-primary)" aria-hidden="true" />
          <h2 id="verify-privacy-heading" style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>
            Verify local-only privacy yourself
          </h2>
        </div>
        <button
          type="button"
          className="btn btn-ghost"
          style={{ padding: '4px 8px', minHeight: '28px' }}
          onClick={() => setPrivacyPanelOpen(false)}
          aria-label="Close privacy verification panel"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      <div style={{ marginTop: 'var(--space-3)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 'var(--space-4)', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
        <div>
          <strong style={{ color: 'var(--text-primary)', display: 'block', marginBottom: '4px' }}>
            1. Inspect the Network tab
          </strong>
          <p style={{ margin: 0 }}>
            Open browser DevTools, switch to the <strong>Network</strong> panel, and import or scan a chat. You will see zero network requests carrying your chat messages, receipts, or summaries.
          </p>
        </div>

        <div>
          <strong style={{ color: 'var(--text-primary)', display: 'block', marginBottom: '4px' }}>
            2. Disconnect &amp; scan offline
          </strong>
          <p style={{ margin: 0 }}>
            Rules-only mode works offline immediately. Once the local WebLLM model is downloaded and cached in your browser storage, you can turn off Wi-Fi or enable Offline mode in DevTools and run full AI scans offline.
          </p>
        </div>

        <div>
          <strong style={{ color: 'var(--text-primary)', display: 'block', marginBottom: '4px' }}>
            3. Zero persistence of chat text
          </strong>
          <p style={{ margin: 0 }}>
            Chat transcripts live strictly in memory inside this tab and are wiped on refresh or when you click <strong>Clear my data</strong>. Only your chosen display name and nicknames are stored in <code>localStorage</code>.
          </p>
        </div>
      </div>
    </section>
  );
}
