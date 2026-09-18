'use client';
import './review-studio.css';

import { useCallback, useEffect, useMemo, useState } from 'react';

type ReviewItem = {
  id: string;
  title?: string;
  member?: string;
  category?: string;
  source?: string;
  imageUrl?: string;
  storageUrl?: string;
  src?: string;
  localPath?: string;
  status: 'review' | 'accept' | 'reject' | string;
  score?: number;
  width?: number;
  height?: number;
  bytes?: number;
  query?: string;
  reasons?: string[];
  _isNew?: boolean;
};

type Counts = { total: number; accept: number; review: number; reject: number; new: number; noMember: number; discoveredToday: number };
type Mode = 'queue' | 'all' | 'accept' | 'reject' | 'reports';
type ImageReport = { id: string; imageId: string; reason: string; note: string; createdAt: string; status: 'pending' | 'dismissed' | 'rejected'; image?: ReviewItem | null };

const PAGE_SIZE = 60;
const modeLabels: Array<[Exclude<Mode, 'reports'>, string]> = [
  ['queue', 'Needs Review'],
  ['all', 'Audit All'],
  ['accept', 'Kept'],
  ['reject', 'Rejected'],
];

function imageUrl(item?: ReviewItem | null) {
  return item?.storageUrl || item?.imageUrl || item?.src || item?.localPath || '';
}

function bytes(value?: number) {
  if (!value) return '—';
  if (value > 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(value / 1024))} KB`;
}

export default function ReviewStudio() {
  const [authed, setAuthed] = useState(false);
  const [key, setKey] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [mode, setMode] = useState<Mode>('queue');
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [counts, setCounts] = useState<Counts>({ total: 0, accept: 0, review: 0, reject: 0, new: 0, noMember: 0, discoveredToday: 0 });
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [activeId, setActiveId] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [member, setMember] = useState('All');
  const [autoAdvance, setAutoAdvance] = useState(true);
  const [notice, setNotice] = useState('');
  const [reports, setReports] = useState<ImageReport[]>([]);
  const [reportsLoaded, setReportsLoaded] = useState(false);
  const [confirmRejectAll, setConfirmRejectAll] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const current = useMemo(() => items.find((item) => item.id === activeId) || items[0] || null, [activeId, items]);

  const toast = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 2600);
  }, []);

  const loadItems = useCallback(async (targetMode = mode, targetPage = 1, append = false): Promise<ReviewItem[]> => {
    const params = new URLSearchParams({ mode: targetMode === 'reports' ? 'all' : targetMode, page: String(targetPage), limit: String(PAGE_SIZE) });
    if (search.trim()) params.set('q', search.trim());
    if (member !== 'All') params.set('member', member);
    const response = await fetch(`/api/internal/review?${params}`, { cache: 'no-store' });
    if (response.status === 401) {
      setAuthed(false);
      return [];
    }
    if (!response.ok) throw new Error('Could not load review queue.');
    const data = await response.json();
    const loadedItems = Array.isArray(data.items) ? data.items : [];
    if (data.counts) setCounts(data.counts);
    setItems((old) => append ? [...old, ...loadedItems] : loadedItems);
    setHasMore(Boolean(data.hasMore));
    setPage(data.page || targetPage);
    if (!append) setActiveId(loadedItems[0]?.id || '');
    return loadedItems as ReviewItem[];
  }, [search, member]);

  const loadReports = useCallback(async () => {
    const response = await fetch('/api/internal/reports?status=pending', { cache: 'no-store' });
    if (response.status === 401) {
      setAuthed(false);
      return;
    }
    if (!response.ok) throw new Error('Could not load reports.');
    const data = await response.json();
    setReports(data.reports || []);
    setReportsLoaded(true);
  }, []);

  async function login() {
    if (!key || loginBusy) return;
    setLoginBusy(true);
    setLoginError('');
    try {
      const response = await fetch('/api/internal/review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'login', key }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Invalid admin key.');
      setAuthed(true);
      setKey('');
      await loadItems('queue', 1, false);
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : 'Login failed.');
    } finally {
      setLoginBusy(false);
    }
  }

  async function logout() {
    await fetch('/api/internal/review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'logout' }) }).catch(() => null);
    setAuthed(false);
    setItems([]);
    setSelected(new Set());
    setReports([]);
    setReportsLoaded(false);
  }

  useEffect(() => {
    fetch('/api/internal/review?mode=queue&limit=1', { cache: 'no-store' }).then((response) => {
      if (response.ok) setAuthed(true);
    }).catch(() => null);
  }, []);

  useEffect(() => {
    if (!authed || mode === 'reports') return;
    const timer = window.setTimeout(() => {
      loadItems(mode, 1, false).catch((error) => toast(error instanceof Error ? error.message : 'Load failed.'));
    }, 140);
    return () => window.clearTimeout(timer);
  }, [authed, mode, search, member, loadItems, toast]);

  useEffect(() => {
    if (authed && mode === 'reports' && !reportsLoaded) {
      loadReports().catch((error) => toast(error instanceof Error ? error.message : 'Load failed.'));
    }
  }, [authed, mode, reportsLoaded, loadReports, toast]);

  async function label(ids: string[], status: 'accept' | 'review' | 'reject') {
    if (!ids.length || saving) return;
    setSaving(true);
    try {
      const response = await fetch('/api/internal/review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'label', ids, status }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Moderation failed.');
      setSelected(new Set());
      await loadItems(mode === 'reports' ? 'all' : mode, Math.max(1, page), false);
      if (autoAdvance && current && ids.includes(current.id)) {
        const next = items.find((item) => item.id !== current.id);
        setActiveId(next?.id || '');
      }
      toast(`${data.changed || ids.length} item${(data.changed || ids.length) === 1 ? '' : 's'} updated.`);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Moderation failed.');
    } finally {
      setSaving(false);
    }
  }

  function toggle(id: string) {
    setSelected((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function selectLoaded() {
    setSelected((selected.size === items.length && items.length > 0) ? new Set() : new Set(items.map((item) => item.id)));
  }

  function rejectUnselected() {
    const keep = new Set(selected);
    const ids = items.map((item) => item.id).filter((id) => !keep.has(id));
    label(ids, 'reject');
  }

  async function resolveReport(report: ImageReport, resolution: 'reject' | 'dismiss') {
    try {
      const response = await fetch('/api/internal/reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'resolve', reportId: report.id, resolution }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Report action failed.');
      setReports((currentReports) => currentReports.filter((item) => item.id !== report.id));
      toast(resolution === 'reject' ? 'Image rejected and hidden from the public archive.' : 'Report dismissed.');
      if (resolution === 'reject') await loadItems(mode === 'reports' ? 'all' : mode, Math.max(1, page), false);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Report action failed.');
    }
  }

  async function rejectAllReports() {
    if (confirmBusy) return;
    setConfirmBusy(true);
    try {
      const response = await fetch('/api/internal/reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'bulk-reject' }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Bulk reject failed.');
      setReports([]);
      toast(`${data.changed || 0} image${data.changed === 1 ? '' : 's'} hidden from the public archive.`);
      setConfirmRejectAll(false);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Bulk reject failed.');
    } finally {
      setConfirmBusy(false);
    }
  }

  async function reviewReport(report: ImageReport) {
    setMode('all');
    setSearch('');
    setMember('All');
    setSelected(new Set());
    setPage(1);
    try {
      const loadedItems = await loadItems('all', 1, false);
      const target = loadedItems.find((item) => item.id === report.imageId);
      setActiveId(target?.id || report.imageId);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not open reported item.');
    }
  }

  if (!authed) {
    return <main className="rs-login-page"><form className="rs-login-card" onSubmit={(event) => { event.preventDefault(); login(); }}><div className="rs-eyebrow">BINI ARCHIVE / PRIVATE</div><h1>Review Studio</h1><p>Moderate the analyzer output without exposing the admin key to the browser beyond the login request.</p><input value={key} onChange={(event) => setKey(event.target.value)} type="password" placeholder="Admin review key" autoFocus /><button className="rs-btn rs-btn-primary" type="submit" disabled={loginBusy}>{loginBusy ? 'Signing in…' : 'Open review studio'}</button>{loginError && <div className="rs-error" role="alert">{loginError}</div>}</form></main>;
  }

  const allSelected = items.length > 0 && selected.size === items.length;

  return <main className="rs-app">
    <header className="rs-topbar"><div className="rs-brand"><a href="/">BINI ARCHIVE</a><span className="rs-divider">/</span><strong>REVIEW STUDIO</strong></div><div className="rs-topstats"><span><b>{counts.review.toLocaleString()}</b> review</span><span><b>{counts.accept.toLocaleString()}</b> kept</span><span><b>{counts.reject.toLocaleString()}</b> rejected</span></div><div className="rs-top-actions"><button onClick={logout}>Sign out</button></div></header>

    <section className="rs-toolbar"><div className="rs-toolbar-row"><div className="rs-tabs">{modeLabels.map(([value, labelText]) => <button key={value} className={mode === value ? 'active' : ''} onClick={() => { setMode(value); setPage(1); setSelected(new Set()); }}>{labelText}</button>)}<button className={mode === 'reports' ? 'active' : ''} onClick={() => { setMode('reports'); setReportsLoaded(false); setSelected(new Set()); }}>Reports {reports.length ? `(${reports.length})` : ''}</button></div><div className="rs-toolbar-right"><div className="rs-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search review data" aria-label="Search review data" /><kbd>/</kbd></div><select value={member} onChange={(event) => setMember(event.target.value)} aria-label="Filter by member"><option>All</option>{['Aiah','Colet','Gwen','Jhoanna','Maloi','Mikha','Stacey','Sheena','OT8'].map((item) => <option key={item}>{item}</option>)}</select></div></div></section>

    {mode !== 'reports' && selected.size > 0 && <div className="rs-bulkbar"><strong>{selected.size} selected</strong><button onClick={() => label([...selected], 'accept')} disabled={saving}>Keep selected</button><button onClick={() => label([...selected], 'reject')} disabled={saving}>Reject selected</button><button onClick={rejectUnselected} disabled={saving || selected.size === items.length}>Reject unselected</button><button onClick={() => setSelected(new Set())}>Clear</button></div>}

    {mode === 'reports' ? <section className="rs-reports-page"><div className="rs-page-head"><div><div className="rs-eyebrow">COMMUNITY MODERATION</div><h1>Reports</h1><p>{reports.length ? `${reports.length} pending report${reports.length === 1 ? '' : 's'}` : 'No pending reports'}</p></div><button className="danger-btn" onClick={() => setConfirmRejectAll(true)} disabled={!reports.length}>Reject all reports</button></div>{reports.length ? <div className="rs-report-list">{reports.map((report) => <article className="rs-report-card" key={report.id}><div className="rs-report-image">{report.image ? <img src={imageUrl(report.image)} alt={report.image.title || 'Reported image'} loading="lazy" decoding="async" /> : <div>Image unavailable</div>}</div><div className="rs-report-body"><div className="rs-report-head"><div><span className="report-reason">{report.reason.replaceAll('-', ' ')}</span><h2>{report.image?.title || report.imageId}</h2></div><time>{new Date(report.createdAt).toLocaleString()}</time></div><p>{report.note || 'No additional note.'}</p><div className="rs-report-actions"><button onClick={() => reviewReport(report)}>Review item</button><button className="danger-btn" onClick={() => resolveReport(report, 'reject')}>Reject image</button><button onClick={() => resolveReport(report, 'dismiss')}>Dismiss</button></div></div></article>)}</div> : <div className="rs-empty"><div className="rs-empty-icon">✓</div><h2>Reports are clear</h2><p>New community reports will appear here.</p></div>}</section> : <div className="rs-layout">
      <aside className="rs-queue"><div className="rs-queue-head"><div><div className="rs-eyebrow">{mode.toUpperCase()}</div><strong>{items.length} loaded</strong><span> · {mode === 'queue' ? `${counts.review.toLocaleString()} awaiting` : `${counts.total.toLocaleString()} total`}</span></div><button onClick={selectLoaded}>{allSelected ? 'Clear loaded' : 'Select loaded'}</button></div><div className="rs-thumb-grid">{items.map((item) => <button key={item.id} className={`rs-thumb ${activeId === item.id ? 'active' : ''} ${selected.has(item.id) ? 'checked' : ''}`} onClick={() => setActiveId(item.id)} aria-label={`Review ${item.title || item.id}`}><img src={imageUrl(item)} alt="" loading="lazy" decoding="async" /><i onClick={(event) => { event.stopPropagation(); toggle(item.id); }} className={selected.has(item.id) ? 'selected-dot' : ''}>{selected.has(item.id) ? '✓' : ''}</i><span className={`rs-badge ${item._isNew ? 'new' : ''}`}>{item.status}</span></button>)}</div>{hasMore && <button className="rs-load-more" onClick={() => loadItems(mode, page + 1, true)} disabled={saving}>Load next 60</button>}</aside>
      <section className="rs-focus">{current ? <><div className="rs-focus-head"><div><div className="rs-eyebrow">ACTIVE ITEM</div><h1>{current.title || current.query || current.id}</h1><p>{current.member || 'No member'} · {current.source || 'Archive'} · {current.category || 'Uncategorized'}</p></div><div className="rs-focus-score"><span>SCORE</span><b>{Number(current.score || 0).toFixed(0)}</b></div></div><div className="rs-image-panel"><img src={imageUrl(current)} alt={current.title || 'Review item'} /><span className="rs-image-flag">{current.status === 'accept' ? 'KEPT' : current.status === 'reject' ? 'REJECTED' : 'NEEDS REVIEW'}</span></div><div className="rs-action-row">{mode !== 'accept' && <button className="keep" disabled={saving} onClick={() => label([current.id], 'accept')}>Keep <kbd>A</kbd></button>}{mode !== 'queue' && <button disabled={saving} onClick={() => label([current.id], 'review')}>Move to review</button>}<button className="skip" onClick={() => { const index = items.findIndex((item) => item.id === current.id); setActiveId(items[(index + 1) % Math.max(1, items.length)]?.id || ''); }}>Skip <kbd>S</kbd></button>{mode !== 'reject' && <button className="reject" disabled={saving} onClick={() => label([current.id], 'reject')}>Reject <kbd>X</kbd></button>}<button className={autoAdvance ? 'toggle active' : 'toggle'} onClick={() => setAutoAdvance((value) => !value)}>Auto-advance {autoAdvance ? 'ON' : 'OFF'}</button></div><div className="rs-info-head"><div><div className="rs-eyebrow">DETAILS</div><strong>{current.id}</strong></div>{mode === 'reject' && <button onClick={() => label([current.id], 'review')}>Restore to review</button>}</div><div className="rs-info-grid"><div><span>MEMBER</span><b>{current.member || 'Unclassified'}</b></div><div><span>STATUS</span><b>{current.status}</b></div><div><span>SIZE</span><b>{current.width && current.height ? `${current.width} × ${current.height}` : '—'}</b></div><div><span>FILE</span><b>{bytes(current.bytes)}</b></div><div className="rs-info-wide"><span>QUERY</span><b>{current.query || '—'}</b></div><div className="rs-info-wide"><span>REASONS</span><b>{Array.isArray(current.reasons) && current.reasons.length ? current.reasons.join(' · ') : '—'}</b></div></div></> : <div className="rs-empty"><div className="rs-empty-icon">✓</div><h2>No items in this view</h2><p>Try another tab or clear the filters.</p></div>}</section>
      <aside className="rs-sidepanel"><div className="rs-side-card"><div className="rs-eyebrow">QUEUE HEALTH</div><div className="rs-health-row"><span>New</span><b>{counts.new}</b></div><div className="rs-health-row"><span>No member</span><b>{counts.noMember}</b></div><div className="rs-health-row"><span>Kept</span><b>{counts.accept}</b></div><div className="rs-health-row"><span>Rejected</span><b>{counts.reject}</b></div></div><div className="rs-side-card"><div className="rs-eyebrow">LOW-END MODE</div><p>60-item batches · lazy thumbnails · detail image only for the active item.</p></div><div className="rs-side-card"><div className="rs-eyebrow">SHORTCUTS</div><p><kbd>A</kbd> Keep · <kbd>X</kbd> Reject · <kbd>S</kbd> Skip</p><p><kbd>←</kbd> <kbd>→</kbd> Navigate · <kbd>/</kbd> Search</p></div></aside>
    </div>}

    {notice && <div className="rs-notice" role="status" aria-live="polite">{notice}<button onClick={() => setNotice('')}>Dismiss</button></div>}
    {confirmRejectAll && <div className="rs-confirm-backdrop" role="presentation"><div className="rs-confirm" role="dialog" aria-modal="true" aria-labelledby="reject-all-title"><div className="rs-eyebrow">DANGEROUS ACTION</div><h2 id="reject-all-title">Reject all pending reports?</h2><p>This will hide every image represented by a pending report from the public archive. Original objects are not deleted.</p><div className="rs-confirm-actions"><button onClick={() => setConfirmRejectAll(false)} disabled={confirmBusy}>Cancel</button><button className="danger-btn" onClick={rejectAllReports} disabled={confirmBusy}>{confirmBusy ? 'Rejecting…' : 'Reject all reports'}</button></div></div></div>}
  </main>;
}
