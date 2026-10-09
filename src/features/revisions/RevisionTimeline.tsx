import React from 'react';
import { History } from 'lucide-react';
import { LedgerItem } from '../../domain/types';
import { useAppStore } from '../../state/store';

interface RevisionTimelineProps {
  item: LedgerItem;
}

export function RevisionTimeline({ item }: RevisionTimelineProps) {
  const { openReceiptsDrawer } = useAppStore();

  if (!item.revisions || item.revisions.length === 0) {
    return null;
  }

  return (
    <div className="revision-box" aria-label="Revision history">
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600, color: 'var(--text-primary)' }}>
        <History size={13} aria-hidden="true" />
        <span>Changed ({item.revisions.length})</span>
      </div>

      {item.revisions.map((rev, idx) => (
        <div key={`${rev.msgId}-${idx}`} className="revision-entry">
          <div>
            <span style={{ color: 'var(--text-muted)' }}>{rev.field}: </span>
            <span className="old-val-strike">{rev.from}</span>
            <span aria-hidden="true"> &rarr; </span>
            <span className="new-val-strong">{rev.to}</span>
            <span style={{ color: 'var(--text-muted)' }}> · by {rev.by}</span>
          </div>

          <button
            type="button"
            className="rev-link-btn"
            onClick={() => openReceiptsDrawer(item, rev.msgId)}
            aria-label={`View source message #${rev.msgId} by ${rev.by}`}
          >
            msg #{rev.msgId}
          </button>
        </div>
      ))}
    </div>
  );
}
