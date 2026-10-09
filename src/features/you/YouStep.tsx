import React, { useState } from 'react';
import { User, Clock, Plus, X, Zap, Sparkles, ArrowLeft } from 'lucide-react';
import { useAppStore, LastReadPreset } from '../../state/store';

function toLocalDateTimeInputValue(ts: number): string {
  if (!ts || !Number.isFinite(ts)) return '';
  const d = new Date(ts);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`.replace('}}', '');
}

export function YouStep() {
  const {
    messages,
    senders,
    importedFileName,
    userName,
    nicknames,
    lastReadPreset,
    lastReadTs,
    engineState,
    setUserName,
    addNickname,
    removeNickname,
    setLastReadPreset,
    startScan,
    setStep,
  } = useAppStore();

  const [nicknameDraft, setNicknameDraft] = useState('');

  const nonSystemMessages = messages.filter((m) => !m.isSystem);
  const unreadMessages = nonSystemMessages.filter((m) => m.ts >= lastReadTs);

  const handleAddNickname = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nicknameDraft.trim()) return;
    addNickname(nicknameDraft);
    setNicknameDraft('');
  };

  const handleCustomDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (!val) return;
    const parsed = new Date(val).getTime();
    if (Number.isFinite(parsed)) {
      setLastReadPreset('custom', parsed);
    }
  };

  const presets: { id: LastReadPreset; label: string; desc: string }[] = [
    {
      id: 'since_my_last',
      label: 'Since my last message',
      desc: 'Default · everything after you last spoke',
    },
    {
      id: 'last_6h',
      label: 'Last 6 hours',
      desc: 'Final 6 hours of the chat transcript',
    },
    {
      id: 'yesterday',
      label: 'Yesterday',
      desc: 'From yesterday 00:00 up to latest message',
    },
    {
      id: 'custom',
      label: 'Custom date-time',
      desc: 'Pick an exact cutoff timestamp',
    },
  ];

  const isAIReady = engineState === 'local_ai_ready';

  return (
    <section className="you-container" aria-labelledby="you-step-heading">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <div>
          <h1 id="you-step-heading" style={{ fontSize: '1.625rem', fontWeight: 700, margin: '0 0 4px 0', letterSpacing: '-0.025em' }}>
            Configure your perspective
          </h1>
          <p style={{ margin: 0, fontSize: '0.90625rem', color: 'var(--text-secondary)' }}>
            Loaded <strong>{nonSystemMessages.length}</strong> messages from <strong>{senders.length}</strong> participants ({importedFileName}).
          </p>
        </div>

        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => setStep(1)}
        >
          <ArrowLeft size={15} aria-hidden="true" />
          <span>Change chat</span>
        </button>
      </div>

      {/* 1. Choose your name */}
      <div className="surface-card field-group">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <User size={18} color="var(--accent-primary)" aria-hidden="true" />
          <label htmlFor="sender-select" className="field-label">
            Your name in this chat
          </label>
        </div>
        <p className="field-hint">
          Select yourself from the detected senders so Receipts can highlight tasks assigned to you and questions mentioning you.
        </p>

        <select
          id="sender-select"
          className="select-input"
          value={userName}
          onChange={(e) => setUserName(e.target.value)}
        >
          <option value="">— Select participant —</option>
          {senders.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        {/* Nicknames */}
        <div style={{ marginTop: 'var(--space-4)', paddingTop: 'var(--space-4)', borderTop: '1px solid var(--border-hairline)' }}>
          <label htmlFor="nickname-input" className="field-label" style={{ display: 'block', marginBottom: '4px' }}>
            Your nicknames or @handles
          </label>
          <p className="field-hint" style={{ marginBottom: 'var(--space-3)' }}>
            Add short names, team handles, or spelling variants people use to address you (saved locally in this browser).
          </p>

          <form onSubmit={handleAddNickname} style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <input
              id="nickname-input"
              type="text"
              className="text-input"
              style={{ flex: 1 }}
              value={nicknameDraft}
              onChange={(e) => setNicknameDraft(e.target.value)}
              placeholder="e.g. Alex, @alex_dev, bhai"
            />
            <button
              type="submit"
              className="btn"
              disabled={!nicknameDraft.trim()}
            >
              <Plus size={15} aria-hidden="true" />
              <span>Add nickname</span>
            </button>
          </form>

          {nicknames.length > 0 && (
            <div className="chip-list" aria-label="Saved nicknames">
              {nicknames.map((nick) => (
                <span key={nick} className="removable-chip">
                  <span>@{nick}</span>
                  <button
                    type="button"
                    className="chip-remove-btn"
                    onClick={() => removeNickname(nick)}
                    aria-label={`Remove nickname ${nick}`}
                  >
                    <X size={13} aria-hidden="true" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 2. I last read... */}
      <div className="surface-card field-group">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Clock size={18} color="var(--accent-primary)" aria-hidden="true" />
            <span className="field-label">I last read…</span>
          </div>

          <span className="engine-pill-badge ready" style={{ fontFamily: 'var(--font-mono)' }}>
            {unreadMessages.length} unread {unreadMessages.length === 1 ? 'message' : 'messages'} in scope
          </span>
        </div>

        <p className="field-hint">
          Receipts scans all unread messages plus up to 300 earlier messages as context for tracking deadline changes and task updates.
        </p>

        <div className="preset-grid" role="group" aria-label="Last read time presets">
          {presets.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`preset-btn ${lastReadPreset === p.id ? 'active' : ''}`}
              onClick={() => setLastReadPreset(p.id, lastReadTs)}
              aria-pressed={lastReadPreset === p.id}
            >
              <div style={{ fontWeight: 600, marginBottom: '3px', color: 'var(--text-primary)' }}>{p.label}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{p.desc}</div>
            </button>
          ))}
        </div>

        {lastReadPreset === 'custom' && (
          <div style={{ marginTop: 'var(--space-3)' }}>
            <label htmlFor="custom-last-read-input" className="field-label" style={{ display: 'block', marginBottom: '6px', fontSize: '0.875rem' }}>
              Custom cutoff date and time
            </label>
            <input
              id="custom-last-read-input"
              type="datetime-local"
              className="text-input"
              value={toLocalDateTimeInputValue(lastReadTs)}
              onChange={handleCustomDateChange}
            />
          </div>
        )}
      </div>

      {/* Scan Action Buttons */}
      <div
        className="surface-card"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--space-4)',
          flexWrap: 'wrap',
          background: 'var(--bg-subtle)',
        }}
      >
        <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
          Ready to scan <strong>{unreadMessages.length}</strong> unread messages (+ up to 300 earlier context messages).
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn"
            onClick={() => void startScan('rules')}
          >
            <Zap size={16} color="var(--accent-primary)" aria-hidden="true" />
            <span>Quick scan (rules only)</span>
          </button>

          <button
            type="button"
            className="btn btn-primary"
            disabled={!isAIReady}
            onClick={() => void startScan('ai')}
            title={
              isAIReady
                ? 'Run local WebGPU AI extraction + Rules reconciliation'
                : 'Click "Load AI model" in the top bar first to enable Scan with AI'
            }
          >
            <Sparkles size={16} aria-hidden="true" />
            <span>Scan with AI</span>
          </button>
        </div>
      </div>
    </section>
  );
}
