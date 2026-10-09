import React, { useEffect, useRef, useState } from 'react';
import { X, Copy, Check, AlertCircle, MessageSquareReply } from 'lucide-react';
import { LedgerItem, Msg } from '../../domain/types';
import { generateDraftReply } from '../../engine/pipeline/reply';
import { copyTextToClipboard } from '../../ui/clipboard';

interface DraftReplyModalProps {
  item: LedgerItem | null;
  messages: Msg[];
  onClose: () => void;
}

export function DraftReplyModal({ item, messages, onClose }: DraftReplyModalProps) {
  const [draftText, setDraftText] = useState('');
  const [contextLabel, setContextLabel] = useState('');
  const [isGeneric, setIsGeneric] = useState(false);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');

  const modalRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const previousActiveRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!item) return;

    const generated = generateDraftReply(item, messages);
    setDraftText(generated.draftText);
    setContextLabel(generated.contextLabel);
    setIsGeneric(generated.isGenericTemplate);
    setCopyStatus('idle');

    previousActiveRef.current = document.activeElement as HTMLElement | null;
    setTimeout(() => {
      textareaRef.current?.focus();
    }, 10);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key === 'Tab' && modalRef.current) {
        const focusable = modalRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previousActiveRef.current?.focus();
    };
  }, [item, messages, onClose]);

  if (!item) return null;

  const handleCopy = async () => {
    const ok = await copyTextToClipboard(draftText);
    setCopyStatus(ok ? 'copied' : 'failed');
    if (ok) {
      setTimeout(() => {
        setCopyStatus((prev) => (prev === 'copied' ? 'idle' : prev));
      }, 2500);
    }
  };

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={modalRef}
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="draft-reply-modal-title"
      >
        <div className="modal-header">
          <div>
            <div className="modal-kicker">
              <MessageSquareReply size={13} aria-hidden="true" />
              <span>Local Reply Draft · Editable</span>
            </div>
            <h2 id="draft-reply-modal-title" className="modal-title">
              Draft reply for &ldquo;{item.title}&rdquo;
            </h2>
          </div>

          <button
            type="button"
            className="btn btn-ghost btn-pill"
            style={{ padding: '5px 8px', minHeight: '32px' }}
            onClick={onClose}
            aria-label="Close draft reply dialog (Esc)"
          >
            <X size={17} aria-hidden="true" />
          </button>
        </div>

        <div className="modal-body">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <label htmlFor="draft-reply-textarea" style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)' }}>
              {contextLabel}
            </label>
            {isGeneric && (
              <span className="meta-chip">
                Generic template
              </span>
            )}
          </div>

          <textarea
            ref={textareaRef}
            id="draft-reply-textarea"
            className="paste-box"
            style={{ minHeight: '110px', fontFamily: 'var(--font-sans)', fontSize: '0.875rem' }}
            value={draftText}
            onChange={(e) => {
              setDraftText(e.target.value);
              if (copyStatus !== 'idle') setCopyStatus('idle');
            }}
          />

          <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            Generated locally from verified source context without inventing commitments or deadlines. Edit freely before copying and pasting into WhatsApp.
          </p>

          {copyStatus === 'failed' && (
            <div className="error-alert" role="alert" style={{ marginBottom: 0, padding: '8px 12px', fontSize: '0.8125rem' }}>
              <AlertCircle size={15} style={{ flexShrink: 0, marginTop: '2px' }} aria-hidden="true" />
              <span>Clipboard access was blocked by your browser. Please select the text above and press Ctrl+C / Cmd+C.</span>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button
            type="button"
            className="btn"
            onClick={onClose}
          >
            Close
          </button>

          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handleCopy()}
            disabled={!draftText.trim()}
          >
            {copyStatus === 'copied' ? (
              <>
                <Check size={15} aria-hidden="true" />
                <span>Copied to clipboard</span>
              </>
            ) : (
              <>
                <Copy size={15} aria-hidden="true" />
                <span>Copy Reply</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
