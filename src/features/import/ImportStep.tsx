import React, { useRef, useState } from 'react';
import { Upload, FileText, Shield, AlertCircle, HelpCircle, Lock } from 'lucide-react';
import { useAppStore } from '../../state/store';
import { MAX_CHAT_FILE_BYTES } from '../../engine/parser/whatsapp';

export function ImportStep() {
  const { importChatText, parseError, setPrivacyPanelOpen, privacyPanelOpen } = useAppStore();
  const [pastedText, setPastedText] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFile = async (file: File) => {
    setLocalError(null);
    if (file.size > MAX_CHAT_FILE_BYTES) {
      setLocalError(
        'File exceeds the 20 MB limit. Please export the chat without media ("Without media") and try again.'
      );
      return;
    }

    try {
      const text = await file.text();
      importChatText(text, file.name, file.size);
    } catch {
      setLocalError('Could not read the selected file. Please make sure it is a plain text (.txt) export.');
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      void handleFile(file);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      void handleFile(file);
    }
  };

  const handlePasteSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    importChatText(pastedText, 'Pasted chat transcript');
  };

  const activeError = localError ?? parseError;

  return (
    <section aria-labelledby="import-step-heading">
      <div className="privacy-banner">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <Shield size={17} color="var(--accent-primary)" aria-hidden="true" />
          <span>
            <strong>Your chat is processed in this browser tab and never uploaded.</strong>
          </span>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-pill"
          style={{ padding: '4px 12px', minHeight: '30px', fontSize: '0.8125rem' }}
          onClick={() => setPrivacyPanelOpen(!privacyPanelOpen)}
        >
          Verify privacy
        </button>
      </div>

      <div className="hero-header">
        <div className="hero-kicker">
          <Lock size={12} aria-hidden="true" />
          <span>Zero Cloud Uploads · Verifiable Source Quotes</span>
        </div>
        <h1 id="import-step-heading" className="hero-title">
          Catch up on overwhelming chats with verifiable receipts
        </h1>
        <p className="hero-subtitle">
          Receipts builds a living ledger of tasks, deadlines, decisions, and questions from your exported WhatsApp conversation. Every card links to exact source messages and tracks revisions over time.
        </p>
      </div>

      {activeError && (
        <div className="error-alert" role="alert">
          <AlertCircle size={18} style={{ flexShrink: 0, marginTop: '2px' }} aria-hidden="true" />
          <div>{activeError}</div>
        </div>
      )}

      <div className="import-grid">
        {/* Left: File Picker / Drag & Drop */}
        <div
          className={`dropzone ${isDragging ? 'drag-over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              fileInputRef.current?.click();
            }
          }}
        >
          <span className="dropzone-icon-ring" aria-hidden="true">
            <Upload size={24} />
          </span>

          <div style={{ maxWidth: '340px' }}>
            <h2 style={{ fontSize: '1.0625rem', fontWeight: 700, margin: '0 0 6px 0', letterSpacing: '-0.01em' }}>
              Upload WhatsApp .txt export
            </h2>
            <p style={{ margin: 0, fontSize: '0.84375rem', color: 'var(--text-secondary)' }}>
              Drag and drop your exported <code>.txt</code> file here, or browse from your device (up to 20 MB).
            </p>
          </div>

          <input
            ref={fileInputRef}
            id="whatsapp-file-input"
            type="file"
            accept=".txt,text/plain"
            onChange={handleFileChange}
            style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
          />
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload size={15} aria-hidden="true" />
            <span>Choose .txt file</span>
          </button>
        </div>

        {/* Right: Paste Chat Text */}
        <form
          className="surface-card"
          onSubmit={handlePasteSubmit}
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <FileText size={18} color="var(--accent-primary)" aria-hidden="true" />
              <label htmlFor="paste-chat-textarea" style={{ fontSize: '1.0625rem', fontWeight: 700, letterSpacing: '-0.01em' }}>
                Paste chat text
              </label>
            </div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              Android &amp; iOS formats
            </span>
          </div>

          <textarea
            id="paste-chat-textarea"
            className="paste-box"
            value={pastedText}
            onChange={(e) => setPastedText(e.target.value)}
            placeholder="Paste exported WhatsApp lines here (e.g. 14/03/25, 9:41 am - Sender: message)..."
            required
          />

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!pastedText.trim()}
            >
              <span>Parse pasted chat</span>
            </button>
          </div>
        </form>
      </div>

      {/* 3-Step Visual WhatsApp Export Guide */}
      <div className="export-guide-card" role="region" aria-labelledby="whatsapp-export-guide-heading">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <HelpCircle size={16} color="var(--accent-primary)" aria-hidden="true" />
            <h3 id="whatsapp-export-guide-heading" style={{ margin: 0, fontSize: '0.90625rem', fontWeight: 700 }}>
              How to export your chat from WhatsApp in 3 steps
            </h3>
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
            Works with iOS &amp; Android exports
          </span>
        </div>

        <div className="export-steps-grid">
          <div className="export-step-item">
            <span className="export-step-num" aria-hidden="true">1</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: '0.84375rem', color: 'var(--text-primary)', marginBottom: '2px' }}>
                Open chat menu
              </div>
              <p style={{ margin: 0, fontSize: '0.78125rem', color: 'var(--text-secondary)' }}>
                Open any group or individual chat in WhatsApp and tap <strong>More</strong> (three dots on Android) or the chat header on iOS.
              </p>
            </div>
          </div>

          <div className="export-step-item">
            <span className="export-step-num" aria-hidden="true">2</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: '0.84375rem', color: 'var(--text-primary)', marginBottom: '2px' }}>
                Export without media
              </div>
              <p style={{ margin: 0, fontSize: '0.78125rem', color: 'var(--text-secondary)' }}>
                Tap <strong>Export chat</strong> and select <strong>Without media</strong> to generate a lightweight <code>.txt</code> transcript.
              </p>
            </div>
          </div>

          <div className="export-step-item">
            <span className="export-step-num" aria-hidden="true">3</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: '0.84375rem', color: 'var(--text-primary)', marginBottom: '2px' }}>
                Drop .txt file above
              </div>
              <p style={{ margin: 0, fontSize: '0.78125rem', color: 'var(--text-secondary)' }}>
                Save or AirDrop the <code>.txt</code> file to your device and drop it into the box above (or paste the lines directly).
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
