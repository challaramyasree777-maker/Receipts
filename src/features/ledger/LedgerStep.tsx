import React, { useState } from 'react';
import {
  Flame,
  Clock,
  Info,
  CheckSquare,
  CalendarClock,
  CheckCircle,
  CheckCircle2,
  HelpCircle,
  Inbox,
  FileText,
  Zap,
  Sparkles,
  Square,
  ArrowDownCircle,
  User,
  History,
  CalendarPlus,
  MessageSquareReply,
  Copy,
  Check,
  ExternalLink,
} from 'lucide-react';
import { LedgerItem } from '../../domain/types';
import { useAppStore, LedgerFilterKey } from '../../state/store';
import { RevisionTimeline } from '../revisions/RevisionTimeline';
import {
  hasValidCalendarDueDate,
  downloadIcsFile,
  buildGoogleCalendarUrl,
} from '../../engine/pipeline/calendar';
import { canDraftReply } from '../../engine/pipeline/reply';
import { formatBriefAsMarkdown } from '../../engine/pipeline/brief';
import { copyTextToClipboard } from '../../ui/clipboard';
import { DraftReplyModal } from './DraftReplyModal';

function formatDueText(due?: number): string | null {
  if (due === undefined) return null;
  const d = new Date(due);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const hours = d.getHours().toString().padStart(2, '0');
  const mins = d.getMinutes().toString().padStart(2, '0');
  return `${d.getDate()} ${months[d.getMonth()]} ${hours}:${mins}`;
}

function KindIcon({ kind }: { kind: LedgerItem['kind'] }) {
  switch (kind) {
    case 'task':
      return <CheckSquare size={15} color="var(--accent-primary)" aria-hidden="true" />;
    case 'deadline':
      return <CalendarClock size={15} color="var(--lane-now)" aria-hidden="true" />;
    case 'decision':
      return <CheckCircle size={15} color="var(--accent-primary)" aria-hidden="true" />;
    case 'question':
      return <HelpCircle size={15} color="var(--lane-soon)" aria-hidden="true" />;
  }
}

interface LedgerItemCardProps {
  item: LedgerItem;
  onOpenDraftReply: (item: LedgerItem) => void;
}

function LedgerItemCard({ item, onOpenDraftReply }: LedgerItemCardProps) {
  const { openReceiptsDrawer } = useAppStore();
  const [calendarMenuOpen, setCalendarMenuOpen] = useState(false);
  const [calendarStatus, setCalendarStatus] = useState<'idle' | 'downloaded' | 'error'>('idle');

  const dueFormatted = formatDueText(item.due);
  const isClosed = item.status === 'done' || item.status === 'cancelled';
  const hasRevisions = item.revisions.length > 0;
  const showCalendarAction = hasValidCalendarDueDate(item);
  const showDraftReplyAction = canDraftReply(item);
  const googleCalUrl = showCalendarAction ? buildGoogleCalendarUrl(item) : '';

  const handleDownloadIcs = () => {
    const ok = downloadIcsFile(item);
    setCalendarStatus(ok ? 'downloaded' : 'error');
    if (ok) {
      setTimeout(() => {
        setCalendarStatus((prev) => (prev === 'downloaded' ? 'idle' : prev));
        setCalendarMenuOpen(false);
      }, 1800);
    }
  };

  return (
    <article
      className={`ledger-card lane-accent-${item.lane} ${isClosed ? 'closed-item' : ''}`}
    >
      <div className="card-top-row">
        <div className="card-title-group">
          <span className="kind-icon-badge" title={`Kind: ${item.kind}`}>
            <KindIcon kind={item.kind} />
          </span>
          <h4 className={`card-title ${isClosed ? 'struck' : ''}`}>
            {item.title}
          </h4>
        </div>

        <span
          className={`source-tag ${item.source === 'ai' ? 'ai' : 'rules'}`}
          title={
            item.source === 'ai'
              ? 'Extracted by local WebGPU AI and verified'
              : 'Extracted by deterministic linguistic rules'
          }
        >
          {item.source === 'ai' ? 'AI' : 'Rules'}
        </span>
      </div>

      {/* Refined Chips Row: Kind, Status, Owner, Due, Changed, Priority */}
      <div className="card-chips-row">
        <span className="meta-chip" style={{ textTransform: 'capitalize' }}>
          {item.kind}
        </span>

        {item.status !== 'open' && (
          <span
            className={`meta-chip ${
              item.status === 'done' ? 'status-done-chip' : 'status-cancelled-chip'
            }`}
          >
            {item.status}
          </span>
        )}

        {item.owner && (
          <span className="meta-chip owner-chip">
            <User size={11} aria-hidden="true" />
            <span>{item.owner}</span>
          </span>
        )}

        {dueFormatted && (
          <span className="meta-chip due-chip">
            <Clock size={11} aria-hidden="true" />
            <span>Due {dueFormatted}</span>
          </span>
        )}

        {hasRevisions && (
          <span className="meta-chip changed-chip">
            <History size={11} aria-hidden="true" />
            <span>Changed</span>
          </span>
        )}

        <span className="meta-chip" style={{ fontFamily: 'var(--font-mono)' }}>
          Priority {item.score}
        </span>
      </div>

      {/* Reasons */}
      {item.reasons.length > 0 && (
        <div className="card-reasons-line">
          {item.reasons.map((reason, idx) => (
            <React.Fragment key={reason}>
              {idx > 0 && <span className="meta-sep" aria-hidden="true">·</span>}
              <span>{reason}</span>
            </React.Fragment>
          ))}
        </div>
      )}

      {/* Revisions timeline if changed */}
      <RevisionTimeline item={item} />

      <div className="card-footer">
        <div className="card-actions-group">
          {showCalendarAction && (
            <div className="calendar-action-wrapper">
              <button
                type="button"
                className="card-action-btn"
                onClick={() => setCalendarMenuOpen((prev) => !prev)}
                aria-expanded={calendarMenuOpen}
              >
                <CalendarPlus size={12} aria-hidden="true" />
                <span>
                  {calendarStatus === 'downloaded' ? 'Saved .ics' : 'Add to Calendar'}
                </span>
              </button>

              {calendarMenuOpen && (
                <div className="calendar-popover" role="region" aria-label="Calendar export options">
                  <button
                    type="button"
                    className="calendar-popover-btn"
                    onClick={handleDownloadIcs}
                  >
                    <CalendarPlus size={13} aria-hidden="true" />
                    <span>Download .ics file (On-device)</span>
                  </button>

                  {googleCalUrl && (
                    <a
                      href={googleCalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="calendar-popover-link"
                      onClick={() => setCalendarMenuOpen(false)}
                    >
                      <ExternalLink size={13} aria-hidden="true" />
                      <span>Open Google Calendar (sends title &amp; date to Google)</span>
                    </a>
                  )}

                  {calendarStatus === 'error' && (
                    <div style={{ fontSize: '0.725rem', color: 'var(--status-danger)', padding: '2px 4px' }}>
                      Could not generate calendar file.
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {showDraftReplyAction && (
            <button
              type="button"
              className="card-action-btn"
              onClick={() => onOpenDraftReply(item)}
            >
              <MessageSquareReply size={12} aria-hidden="true" />
              <span>Draft Reply</span>
            </button>
          )}
        </div>

        <button
          type="button"
          className="receipts-btn"
          onClick={() => openReceiptsDrawer(item)}
        >
          <FileText size={12} aria-hidden="true" />
          <span>Receipts ({item.receipts.length})</span>
        </button>
      </div>
    </article>
  );
}

export function LedgerStep() {
  const {
    scanSnapshot,
    messages,
    isScanning,
    engineState,
    activeFilters,
    toggleFilter,
    startScan,
    scanDeeper,
    cancelScan,
  } = useAppStore();

  const [draftReplyItem, setDraftReplyItem] = useState<LedgerItem | null>(null);
  const [briefCopyStatus, setBriefCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');

  const items = scanSnapshot?.items ?? [];
  const brief = scanSnapshot?.brief;

  // Apply filter buttons
  const filteredItems = items.filter((item) => {
    if (activeFilters.onMe && !item.onMe) return false;
    if (activeFilters.changed && item.revisions.length === 0 && !item.changedWhileAway) return false;
    if (activeFilters.questions && item.kind !== 'question') return false;
    if (activeFilters.done && item.status !== 'done' && item.status !== 'cancelled') return false;
    return true;
  });

  const nowLaneItems = filteredItems.filter((i) => i.lane === 'now');
  const soonLaneItems = filteredItems.filter((i) => i.lane === 'soon');
  const fyiLaneItems = filteredItems.filter((i) => i.lane === 'fyi');

  const itemsNeedingYouCount = items.filter((i) => i.onMe && i.status === 'open').length;
  const changedWhileAwayCount = items.filter((i) => i.changedWhileAway).length;
  const isAIReady = engineState === 'local_ai_ready';

  const progressPct =
    scanSnapshot && scanSnapshot.totalWindows > 0
      ? Math.round((scanSnapshot.currentWindow / scanSnapshot.totalWindows) * 100)
      : 0;

  const filterButtons: { key: LedgerFilterKey; label: string }[] = [
    { key: 'onMe', label: 'On me' },
    { key: 'changed', label: 'Changed' },
    { key: 'questions', label: 'Questions' },
    { key: 'done', label: 'Done' },
  ];

  const handleCopyBrief = async () => {
    if (!brief) return;
    const markdown = formatBriefAsMarkdown(brief, filteredItems);
    const ok = await copyTextToClipboard(markdown);
    setBriefCopyStatus(ok ? 'copied' : 'failed');
    setTimeout(() => {
      setBriefCopyStatus('idle');
    }, 2500);
  };

  return (
    <section aria-labelledby="ledger-step-heading">
      {/* Progress bar during scan */}
      {isScanning && scanSnapshot && (
        <div className="scan-progress-bar" role="status" aria-live="polite">
          <div style={{ minWidth: '185px', fontSize: '0.875rem', fontWeight: 600 }}>
            {scanSnapshot.statusText}
          </div>
          <div className="progress-track" aria-hidden="true">
            <div className="progress-fill" style={{ width: `${progressPct}%` }} />
          </div>
          <button
            type="button"
            className="btn"
            style={{ padding: '5px 12px', minHeight: '32px', fontSize: '0.8125rem' }}
            onClick={cancelScan}
          >
            <Square size={13} aria-hidden="true" />
            <span>Cancel</span>
          </button>
        </div>
      )}

      {/* Catch-up brief card at the very top */}
      {brief && (
        <div className="brief-card" aria-labelledby="ledger-step-heading">
          <div className="brief-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <h2 id="ledger-step-heading" className="brief-title">
                Catch-up brief
              </h2>
              <span className="engine-pill-badge ready" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.725rem' }}>
                Deterministic summary · computed locally
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                type="button"
                className="btn"
                style={{ padding: '5px 12px', minHeight: '32px', fontSize: '0.78125rem' }}
                onClick={() => void handleCopyBrief()}
              >
                {briefCopyStatus === 'copied' ? (
                  <>
                    <Check size={14} color="var(--status-done)" aria-hidden="true" />
                    <span>Copied Markdown</span>
                  </>
                ) : (
                  <>
                    <Copy size={14} aria-hidden="true" />
                    <span>Copy Brief</span>
                  </>
                )}
              </button>
              {briefCopyStatus === 'failed' && (
                <span role="alert" style={{ fontSize: '0.75rem', color: 'var(--status-danger)' }}>
                  Copy failed
                </span>
              )}
            </div>
          </div>

          {brief.isEmpty ? (
            <p style={{ margin: 0, color: 'var(--text-secondary)', fontWeight: 500 }}>
              {brief.emptyText}
            </p>
          ) : (
            <div>
              {brief.summaryLines.map((line, i) => (
                <p key={i} style={{ margin: '0 0 6px 0', color: 'var(--text-secondary)', fontSize: '0.9375rem' }}>
                  {line}
                </p>
              ))}

              {brief.topNowItems.length > 0 && (
                <div style={{ marginTop: 'var(--space-3)', paddingTop: 'var(--space-3)', borderTop: '1px solid var(--border-hairline)' }}>
                  <div style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--lane-now)' }}>
                    Top items in Needs you now:
                  </div>
                  <ul className="brief-top-list">
                    {brief.topNowItems.map((top) => (
                      <li key={top.id}>
                        <strong>{top.title}</strong>
                        {top.dueFormatted ? ` (Due ${top.dueFormatted})` : ''}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Stats Strip */}
      <div className="stats-strip" role="region" aria-label="Scan statistics">
        <div className="stat-cell">
          <span className="stat-value">{scanSnapshot?.messagesScanned ?? 0}</span>
          <span className="stat-label">messages scanned</span>
        </div>
        <div className="stat-cell">
          <span className="stat-value" style={{ color: 'var(--accent-primary)' }}>{itemsNeedingYouCount}</span>
          <span className="stat-label">items that need you</span>
        </div>
        <div className="stat-cell">
          <span className="stat-value" style={{ color: 'var(--lane-soon)' }}>{changedWhileAwayCount}</span>
          <span className="stat-label">changed while you were away</span>
        </div>
        <div className="stat-cell">
          <span className="stat-value">{scanSnapshot?.rejectedByVerifierCount ?? 0}</span>
          <span className="stat-label">rejected by verifier</span>
        </div>
      </div>

      {/* Controls & Filters Toolbar */}
      <div className="ledger-toolbar">
        <div className="filter-bar" role="group" aria-label="Filter ledger items">
          <span style={{ fontSize: '0.78125rem', fontWeight: 600, color: 'var(--text-muted)', paddingLeft: '8px', paddingRight: '4px' }}>
            Filter
          </span>
          {filterButtons.map((fb) => (
            <button
              key={fb.key}
              type="button"
              className={`filter-btn ${activeFilters[fb.key] ? 'active' : ''}`}
              onClick={() => toggleFilter(fb.key)}
              aria-pressed={activeFilters[fb.key]}
            >
              {fb.label}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          {scanSnapshot?.hasMoreWindows && !isScanning && (
            <button
              type="button"
              className="btn"
              onClick={() => void scanDeeper()}
            >
              <ArrowDownCircle size={15} aria-hidden="true" />
              <span>Scan deeper ({scanSnapshot.totalWindows}/{scanSnapshot.totalUncappedWindows} windows)</span>
            </button>
          )}

          <button
            type="button"
            className="btn"
            disabled={isScanning}
            onClick={() => void startScan('rules')}
          >
            <Zap size={15} color="var(--accent-primary)" aria-hidden="true" />
            <span>Quick scan (rules only)</span>
          </button>

          <button
            type="button"
            className="btn btn-primary"
            disabled={!isAIReady || isScanning}
            onClick={() => void startScan('ai')}
            title={
              isAIReady
                ? 'Scan with local WebGPU AI'
                : 'Load the local AI model in the top bar first'
            }
          >
            <Sparkles size={15} aria-hidden="true" />
            <span>Scan with AI</span>
          </button>
        </div>
      </div>

      {/* Honest Empty State */}
      {!isScanning && items.length === 0 && (
        <div className="surface-card" style={{ textAlign: 'center', padding: 'var(--space-6)' }}>
          <h3 style={{ margin: '0 0 6px 0', fontSize: '1.125rem', fontWeight: 700 }}>
            No items found in this part of the chat
          </h3>
          <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
            Receipts never pads the ledger with invented tasks. Try adjusting your &ldquo;I last read&rdquo; cutoff in Step 2 or scanning deeper if your chat has earlier messages.
          </p>
        </div>
      )}

      {/* Three Lanes */}
      {(items.length > 0 || isScanning) && (
        <div className="lanes-grid">
          {/* Lane 1: Needs you now */}
          <div className="lane-column" role="region" aria-labelledby="lane-now-heading">
            <div className="lane-header lane-now">
              <div className="lane-header-left">
                <Flame size={17} aria-hidden="true" />
                <span id="lane-now-heading">Needs you now</span>
              </div>
              <span className="lane-count">{nowLaneItems.length}</span>
            </div>

            {nowLaneItems.map((item) => (
              <LedgerItemCard
                key={item.id}
                item={item}
                onOpenDraftReply={(target) => setDraftReplyItem(target)}
              />
            ))}

            {isScanning && nowLaneItems.length === 0 && (
              <div className="skeleton-card" aria-hidden="true">
                <div className="skeleton-line" style={{ width: '75%' }} />
                <div className="skeleton-line" style={{ width: '50%' }} />
              </div>
            )}

            {!isScanning && nowLaneItems.length === 0 && (
              <div className="lane-empty-state">
                <CheckCircle2 size={20} color="var(--status-done)" aria-hidden="true" />
                <div className="lane-empty-title">No urgent items right now</div>
                <p className="lane-empty-desc">
                  Nothing overdue or due within 24 hours requires your immediate attention.
                </p>
              </div>
            )}
          </div>

          {/* Lane 2: Soon */}
          <div className="lane-column" role="region" aria-labelledby="lane-soon-heading">
            <div className="lane-header lane-soon">
              <div className="lane-header-left">
                <Clock size={17} aria-hidden="true" />
                <span id="lane-soon-heading">Soon</span>
              </div>
              <span className="lane-count">{soonLaneItems.length}</span>
            </div>

            {soonLaneItems.map((item) => (
              <LedgerItemCard
                key={item.id}
                item={item}
                onOpenDraftReply={(target) => setDraftReplyItem(target)}
              />
            ))}

            {isScanning && soonLaneItems.length === 0 && (
              <div className="skeleton-card" aria-hidden="true">
                <div className="skeleton-line" style={{ width: '70%' }} />
                <div className="skeleton-line" style={{ width: '45%' }} />
              </div>
            )}

            {!isScanning && soonLaneItems.length === 0 && (
              <div className="lane-empty-state">
                <Clock size={20} color="var(--text-secondary)" aria-hidden="true" />
                <div className="lane-empty-title">No upcoming items in Soon</div>
                <p className="lane-empty-desc">
                  No medium-priority tasks or open questions are queued for the next few days.
                </p>
              </div>
            )}
          </div>

          {/* Lane 3: FYI */}
          <div className="lane-column" role="region" aria-labelledby="lane-fyi-heading">
            <div className="lane-header lane-fyi">
              <div className="lane-header-left">
                <Info size={17} aria-hidden="true" />
                <span id="lane-fyi-heading">FYI</span>
              </div>
              <span className="lane-count">{fyiLaneItems.length}</span>
            </div>

            {fyiLaneItems.map((item) => (
              <LedgerItemCard
                key={item.id}
                item={item}
                onOpenDraftReply={(target) => setDraftReplyItem(target)}
              />
            ))}

            {isScanning && fyiLaneItems.length === 0 && (
              <div className="skeleton-card" aria-hidden="true">
                <div className="skeleton-line" style={{ width: '80%' }} />
                <div className="skeleton-line" style={{ width: '55%' }} />
              </div>
            )}

            {!isScanning && fyiLaneItems.length === 0 && (
              <div className="lane-empty-state">
                <Inbox size={20} color="var(--text-secondary)" aria-hidden="true" />
                <div className="lane-empty-title">Nothing in FYI</div>
                <p className="lane-empty-desc">
                  Background decisions, general notes, and completed items will appear here.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      <DraftReplyModal
        item={draftReplyItem}
        messages={messages}
        onClose={() => setDraftReplyItem(null)}
      />
    </section>
  );
}
