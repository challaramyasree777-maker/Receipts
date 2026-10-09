import React, { useEffect, useRef } from 'react';
import { X, FileCheck2, Quote } from 'lucide-react';
import { useAppStore } from '../../state/store';
import { Msg } from '../../domain/types';

function formatMessageTime(ts: number): string {
  const d = new Date(ts);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const hours = d.getHours().toString().padStart(2, '0');
  const mins = d.getMinutes().toString().padStart(2, '0');
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}, ${hours}:${mins}`;
}

function renderMessageWithVerifiedQuote(text: string, quote?: string): React.ReactNode {
  if (!quote || !quote.trim()) {
    return text;
  }

  const trimmedQuote = quote.trim();
  const lowerText = text.toLowerCase();
  const lowerQuote = trimmedQuote.toLowerCase();
  const matchIdx = lowerText.indexOf(lowerQuote);

  if (matchIdx === -1) {
    return text;
  }

  const before = text.slice(0, matchIdx);
  const matched = text.slice(matchIdx, matchIdx + trimmedQuote.length);
  const after = text.slice(matchIdx + trimmedQuote.length);

  return (
    <>
      {before}
      <mark className="verified-quote-mark">{matched}</mark>
      {after}
    </>
  );
}

export function ReceiptsDrawer() {
  const {
    activeReceiptItem,
    activeReceiptTargetMsgId,
    messages,
    closeReceiptsDrawer,
  } = useAppStore();

  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!activeReceiptItem) return;

    previousActiveElementRef.current = document.activeElement as HTMLElement | null;
    closeBtnRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeReceiptsDrawer();
        return;
      }

      if (e.key === 'Tab' && panelRef.current) {
        const focusable = panelRef.current.querySelectorAll<HTMLElement>(
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
      previousActiveElementRef.current?.focus();
    };
  }, [activeReceiptItem, closeReceiptsDrawer]);

  if (!activeReceiptItem) return null;

  const citedIds = new Set<number>(activeReceiptItem.receipts.map((r) => r.msgId));
  for (const rev of activeReceiptItem.revisions) {
    citedIds.add(rev.msgId);
  }
  if (activeReceiptTargetMsgId !== null) {
    citedIds.add(activeReceiptTargetMsgId);
  }

  // Build context slices: 3 messages before and 3 messages after each cited message
  const includedIndices = new Set<number>();
  messages.forEach((m, idx) => {
    if (citedIds.has(m.id)) {
      const start = Math.max(0, idx - 3);
      const end = Math.min(messages.length - 1, idx + 3);
      for (let k = start; k <= end; k++) {
        includedIndices.add(k);
      }
    }
  });

  const sortedIndices = Array.from(includedIndices).sort((a, b) => a - b);
  const contextBlocks: { gapBefore: boolean; msg: Msg }[] = [];
  for (let i = 0; i < sortedIndices.length; i++) {
    const idx = sortedIndices[i];
    const prevIdx = i > 0 ? sortedIndices[i - 1] : idx - 1;
    contextBlocks.push({
      gapBefore: i > 0 && idx - prevIdx > 1,
      msg: messages[idx],
    });
  }

  return (
    <div
      className="drawer-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          closeReceiptsDrawer();
        }
      }}
    >
      <div
        ref={panelRef}
        className="drawer-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="receipts-drawer-title"
      >
        <div className="drawer-header">
          <div>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '0.75rem',
                fontWeight: 700,
                color: 'var(--accent-soft-text)',
                background: 'var(--accent-soft-bg)',
                border: '1px solid var(--accent-soft-border)',
                padding: '2px 9px',
                borderRadius: 'var(--radius-pill)',
                marginBottom: '8px',
              }}
            >
              <FileCheck2 size={13} aria-hidden="true" />
              <span>Verified Source Receipts ({citedIds.size})</span>
            </div>
            <h2 id="receipts-drawer-title" style={{ margin: 0, fontSize: '1.125rem', fontWeight: 700, letterSpacing: '-0.015em' }}>
              {activeReceiptItem.title}
            </h2>
          </div>

          <button
            ref={closeBtnRef}
            type="button"
            className="btn btn-ghost btn-pill"
            style={{ padding: '6px 10px', minHeight: '34px' }}
            onClick={closeReceiptsDrawer}
            aria-label="Close receipts drawer (Esc)"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="drawer-body">
          <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
            Showing exact source transcript with 3 messages of surrounding context. Cited messages and verified quotes are highlighted.
          </div>

          {contextBlocks.map(({ gapBefore, msg }) => {
            const isCited = citedIds.has(msg.id);
            const matchingReceipt = activeReceiptItem.receipts.find((r) => r.msgId === msg.id);

            return (
              <React.Fragment key={msg.id}>
                {gapBefore && (
                  <div
                    style={{
                      textAlign: 'center',
                      fontSize: '0.75rem',
                      color: 'var(--text-muted)',
                      fontFamily: 'var(--font-mono)',
                      padding: '4px 0',
                    }}
                  >
                    ··· earlier messages skipped ···
                  </div>
                )}

                <article
                  className={`transcript-msg ${isCited ? 'cited' : ''}`}
                  aria-label={isCited ? `Cited message #${msg.id} from ${msg.sender}` : `Context message #${msg.id} from ${msg.sender}`}
                >
                  <div className="transcript-msg-header">
                    <span className="transcript-sender">
                      <span>{msg.sender}</span>
                      {isCited && <span className="cited-pill">CITED RECEIPT</span>}
                    </span>
                    <span>
                      #{msg.id} · {formatMessageTime(msg.ts)}
                    </span>
                  </div>

                  <div style={{ whiteSpace: 'pre-wrap', color: 'var(--text-primary)', lineHeight: 1.55 }}>
                    {renderMessageWithVerifiedQuote(msg.text, matchingReceipt?.quote)}
                  </div>

                  {matchingReceipt && (
                    <div className="verified-quote-callout">
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontWeight: 600, color: 'var(--accent-soft-text)', marginRight: '6px' }}>
                        <Quote size={12} aria-hidden="true" />
                        <span>Verified quote:</span>
                      </span>
                      <span>&ldquo;{matchingReceipt.quote}&rdquo;</span>
                    </div>
                  )}
                </article>
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}
