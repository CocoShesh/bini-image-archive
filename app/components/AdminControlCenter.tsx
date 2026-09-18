'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import './admin-control.css';

type AnyRecord = Record<string, any>;
type WorkerState = AnyRecord & { workerId?: number };
type Counts = { review: number; accept: number; reject: number; new: number; noMember: number; discoveredToday: number };
type Data = {
  counts: Counts;
  stats: {
    libraryCount: number;
    libraryUpdatedAt: string | null;
    libraryBytes: number;
    crawler: AnyRecord | null;
    analyzer: AnyRecord | null;
    recentActivity: AnyRecord[];
    duplicateGroups: number | null;
    duplicatePairs: number | null;
    storageObjects: number;
    missingImages: number;
  };
};

type Section = 'overview' | 'crawler' | 'review' | 'library' | 'duplicates' | 'analyzer' | 'activity' | 'storage' | 'settings';
const API = '/api/internal/review';
const ACTIONS_URL = 'https://github.com/CocoShesh/bini-image-archive/actions';

function num(v: any) { return Number.isFinite(Number(v)) ? Number(v) : 0; }
function fmt(v: any) { if (!v) return '—'; const d = new Date(String(v)); return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); }
function fmtBytes(v: any) { const n = num(v); if (!n) return '0 B'; const u = ['B','KB','MB','GB','TB']; const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024))); return `${(n / (1024 ** i)).toFixed(i ? 1 : 0)} ${u[i]}`; }
function pct(v: number, total: number) { if (!total) return 0; return Math.max(0, Math.min(100, Math.round((v / total) * 100))); }
function pretty(k: string) { return k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ').replace(/^./, c => c.toUpperCase()); }

function statusMeta(status: string) {
  if (status === 'running') return { label: 'RUNNING', tone: 'live' };
  if (status === 'complete') return { label: 'COMPLETED', tone: 'good' };
  if (status === 'paused') return { label: 'PAUSED · RESUMABLE', tone: 'warn' };
  if (status === 'checkpoint') return { label: 'CHECKPOINT SAVED', tone: 'muted' };
  return { label: 'IDLE', tone: 'muted' };
}

function workerProgress(w: WorkerState) {
  const start = num(w.startIndex); const end = num(w.endIndex); const next = num(w.nextQueryIndex);
  if (end <= start) return w.status === 'complete' ? 100 : 0;
  return pct(next - start, end - start);
}

export default function AdminControlCenter({ gate }: { gate: string }) {
  const [authed, setAuthed] = useState(false);
  const [key, setKey] = useState('');
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [active, setActive] = useState<Section>('overview');
  const [palette, setPalette] = useState(false);
  const reviewUrl = `/ops/${encodeURIComponent(gate)}/review`;

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const r = await fetch(`${API}?page=1&limit=1&mode=all&priority=newest`, { cache: 'no-store' });
      if (r.status === 401) { setAuthed(false); return; }
      if (!r.ok) throw new Error(`Request failed (${r.status})`);
      const j = await r.json(); setData({ counts: j.counts, stats: j.stats }); setAuthed(true);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load admin dashboard.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!authed) return; const id = window.setInterval(() => void load(), 10000); return () => window.clearInterval(id); }, [authed, load]);
  useEffect(() => { if (!authed) return; const onKey = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(v => !v); } if (e.key === 'Escape') setPalette(false); }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }, [authed]);

  async function login() {
    setLoading(true); setError('');
    try {
      const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'login', key }) });
      const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Invalid admin key.');
      setKey(''); await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Login failed.'); }
    finally { setLoading(false); }
  }

  async function lock() {
    await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'logout' }) });
    setAuthed(false); setData(null);
  }

  const crawler = data?.stats?.crawler ?? null;
  const analyzer = data?.stats?.analyzer ?? null;
  const counts = data?.counts;
  const workers: WorkerState[] = Array.isArray(crawler?.workers) ? crawler.workers : [];
  const totalQueries = num(crawler?.totalQueries);
  const baseIndex = num(crawler?.baseIndex);
  const nextQuery = num(crawler?.nextQueryIndex);
  const crawlPct = pct(nextQuery - baseIndex, totalQueries - baseIndex);
  const cStatus = statusMeta(String(crawler?.status || 'none'));
  const mergeLabel = crawler?.mergeStatus === 'complete' ? 'Complete' : crawler?.mergeStatus === 'ready' ? 'Ready' : crawler?.mergeStatus === 'resumable' ? 'Resumable' : crawler?.mergeStatus === 'waiting-for-workers' ? 'Waiting for workers' : 'Waiting';

  const nav = [
    ['overview', 'Overview', '⌂', 'Operations summary'],
    ['crawler', 'Crawler', '↻', 'Workers, checkpoints, runs'],
    ['review', 'Review Queue', '✓', `${num(counts?.review).toLocaleString()} pending`],
    ['library', 'Library', '▦', `${num(data?.stats?.libraryCount).toLocaleString()} indexed`],
    ['duplicates', 'Duplicates', '◈', `${num(data?.stats?.duplicateGroups)} groups`],
    ['analyzer', 'Analyzer', '◇', 'CPU analysis'],
    ['activity', 'Activity', '≋', 'Recent operations'],
    ['storage', 'Storage', '◫', fmtBytes(data?.stats?.libraryBytes)],
    ['settings', 'Settings', '⚙', 'Security & system'],
  ] as const;

  if (!authed) return (
    <main className="ac-app ac-login"><section className="ac-login-card">
      <div className="ac-kicker">PRIVATE OPERATIONS</div><h1>Admin Control Center</h1><p>Private operations workspace for crawler, library, analyzer, duplicates and moderation.</p>
      <input autoFocus type="password" value={key} onChange={e => setKey(e.target.value)} onKeyDown={e => e.key === 'Enter' && login()} placeholder="Admin key" />
      <button className="ac-primary" onClick={login} disabled={loading}>{loading ? 'Unlocking…' : 'Unlock admin'}</button>
      {error && <div className="ac-error">{error}</div>}
    </section></main>
  );

  return <main className="ac-app">
    <header className="ac-topbar">
      <div className="ac-brand"><a href="/">BINI ARCHIVE</a><span>/</span><strong>OPERATIONS</strong></div>
      <div className="ac-top-actions"><button className="ac-command-trigger" onClick={() => setPalette(true)}>⌘K <span>Command</span></button><div className="ac-system-chip"><i/>Live</div><a className="ac-review" href={reviewUrl}>Open Review</a><button onClick={() => void load()}>{loading ? 'Refreshing…' : 'Refresh'}</button><button onClick={lock}>Lock</button></div>
    </header>
    <div className="ac-shell">
      <aside className="ac-sidebar">
        <div className="ac-side-label">Control Center</div>
        {nav.map(([id,label,icon,meta]) => <button key={id} className={active === id ? 'active' : ''} onClick={() => setActive(id as Section)}><span className="ac-nav-icon">{icon}</span><span className="ac-nav-copy"><b>{label}</b><em>{meta}</em></span></button>)}
        <div className="ac-side-spacer" />
        <a className="ac-side-link" href={reviewUrl}>✓ Review Studio</a>
        <a className="ac-side-link" href={ACTIONS_URL} target="_blank" rel="noreferrer">↗ GitHub Actions</a>
      </aside>

      <section className="ac-main">
        <div className="ac-pagehead"><div><div className="ac-kicker">PRIVATE ARCHIVE OPS</div><h1>{nav.find(([id]) => id === active)?.[1]}</h1><p>{nav.find(([id]) => id === active)?.[3]}</p></div><div className="ac-head-right"><span>Auto-refresh 10s</span><span>{fmt(data?.stats?.libraryUpdatedAt)}</span></div></div>

        {active === 'overview' && <Overview data={data} crawler={crawler} workers={workers} crawlPct={crawlPct} cStatus={cStatus} mergeLabel={mergeLabel} setActive={setActive} reviewUrl={reviewUrl} />}
        {active === 'crawler' && <Crawler data={data} crawler={crawler} workers={workers} cStatus={cStatus} crawlPct={crawlPct} mergeLabel={mergeLabel} />}
        {active === 'review' && <ReviewOverview counts={counts} reviewUrl={reviewUrl} />}
        {active === 'library' && <Library data={data} counts={counts} />}
        {active === 'duplicates' && <Duplicates data={data} />}
        {active === 'analyzer' && <Analyzer analyzer={analyzer} />}
        {active === 'activity' && <Activity items={data?.stats?.recentActivity || []} />}
        {active === 'storage' && <Storage data={data} />}
        {active === 'settings' && <Settings crawler={crawler} />}
      </section>
    </div>
    <nav className="ac-mobile-nav" aria-label="Admin mobile navigation">
      <button
        className={`ac-mobile-nav-item ${active === 'overview' ? 'active' : ''}`}
        onClick={() => setActive('overview')}
        aria-label="Overview"
        aria-pressed={active === 'overview'}
      >
        <span className="ac-mobile-nav-icon">⌂</span>
        <span>Overview</span>
      </button>

      <button
        className={`ac-mobile-nav-item ${active === 'crawler' ? 'active' : ''}`}
        onClick={() => setActive('crawler')}
        aria-label="Crawler"
        aria-pressed={active === 'crawler'}
      >
        <span className="ac-mobile-nav-icon">↻</span>
        <span>Crawler</span>
      </button>

      <button
        className={`ac-mobile-nav-item ${active === 'review' ? 'active' : ''}`}
        onClick={() => setActive('review')}
        aria-label="Review"
        aria-pressed={active === 'review'}
      >
        <span className="ac-mobile-nav-icon">✓</span>
        <span>Review{num(counts?.review) ? ` · ${num(counts?.review)}` : ''}</span>
      </button>

      <button
        className={`ac-mobile-nav-item ${active === 'activity' ? 'active' : ''}`}
        onClick={() => setActive('activity')}
        aria-label="Activity"
        aria-pressed={active === 'activity'}
      >
        <span className="ac-mobile-nav-icon">≋</span>
        <span>Activity</span>
      </button>

      <button
        className="ac-mobile-nav-item"
        onClick={() => setPalette(true)}
        aria-label="More admin sections"
      >
        <span className="ac-mobile-nav-icon">☰</span>
        <span>More</span>
      </button>
    </nav>

    {palette && <CommandPalette setActive={setActive} reviewUrl={reviewUrl} close={() => setPalette(false)} />}
  </main>;
}

function Overview({data,crawler,workers,crawlPct,cStatus,mergeLabel,setActive,reviewUrl}:{data:Data|null;crawler:AnyRecord|null;workers:WorkerState[];crawlPct:number;cStatus:any;mergeLabel:string;setActive:(s:Section)=>void;reviewUrl:string}) {
  const counts=data?.counts;
  const total=Math.max(1,num(data?.stats?.libraryCount));
  const accept=num(counts?.accept), review=num(counts?.review), reject=num(counts?.reject);
  const acceptDeg=(accept/total)*360; const reviewDeg=((accept+review)/total)*360;
  const alerts = buildAlerts(data, crawler);
  return <>
    {alerts.length ? <AlertStrip alerts={alerts} /> : <section className="ac-clear"><span className="ac-clear-dot"/>All observed systems are clear. No active alerts.</section>}
    <section className="ac-hero ac-card">
      <div className="ac-hero-copy"><div className="ac-kicker">CRAWLER COMMAND</div><div className="ac-hero-title"><h2>{cStatus.label}</h2><span className={`ac-badge ${cStatus.tone}`}><i/> {cStatus.label}</span></div><p>{crawler ? `${num(crawler.nextQueryIndex).toLocaleString()} of ${num(crawler.totalQueries).toLocaleString()} queries reached. The dashboard is reading the latest worker checkpoints.` : 'No crawler run is currently reporting state.'}</p><div className="ac-progress"><div style={{width:`${crawlPct}%`}}/></div><div className="ac-progress-meta"><span>{crawlPct}% complete</span><span>{crawler ? `${num(crawler.nextQueryIndex).toLocaleString()} / ${num(crawler.totalQueries).toLocaleString()}` : 'Awaiting run'}</span></div><div className="ac-hero-actions"><button onClick={()=>setActive('crawler')}>View crawler details →</button><a href="https://github.com/CocoShesh/bini-image-archive/actions" target="_blank" rel="noreferrer">Open GitHub Actions ↗</a><a href={reviewUrl}>Review new items →</a></div></div>
      <div className="ac-hero-stats"><Stat label="Merge" value={mergeLabel}/><Stat label="Resume" value={crawler?.nextQueryIndex != null ? Number(crawler.nextQueryIndex).toLocaleString() : '—'}/><Stat label="Workers" value={`${workers.filter(w=>w.status==='complete').length}/5 done`}/><Stat label="Updated" value={fmt(crawler?.updatedAt)}/></div>
    </section>

    <section className="ac-metrics"><Metric label="Indexed" value={num(data?.stats?.libraryCount)} note="Current library"/><Metric label="Review queue" value={num(counts?.review)} note={`${num(counts?.new)} new discoveries`} tone="amber"/><Metric label="Discovered today" value={num(counts?.discoveredToday)} note="Fresh crawl output" tone="green"/><Metric label="No member" value={num(counts?.noMember)} note="Needs metadata" tone="violet"/></section>

    <section className="ac-grid-2">
      <Panel title="Five-way worker matrix" kicker="CRAWLER" action="Details →" onAction={()=>setActive('crawler')}><div className="ac-workers">{workers.length ? workers.map((w,i)=><WorkerRow key={i} worker={w} index={i}/>) : <Empty text="No worker state available."/>}</div></Panel>
      <Panel title="Library mix" kicker="CONTENT HEALTH"><div className="ac-donut-wrap"><div className="ac-donut" style={{background:`conic-gradient(#aa8f70 0 ${acceptDeg}deg,#6f685d ${acceptDeg}deg ${reviewDeg}deg,#725656 ${reviewDeg}deg 360deg)`}}><span>{total.toLocaleString()}</span></div><div className="ac-legend"><Legend label="Accepted" value={accept} tone="cream"/><Legend label="Review" value={review} tone="amber"/><Legend label="Rejected" value={reject} tone="red"/></div></div><div className="ac-mini-bars"><Bar label="New today" value={num(counts?.discoveredToday)} max={Math.max(1,num(data?.stats?.libraryCount))}/><Bar label="No member" value={num(counts?.noMember)} max={Math.max(1,num(data?.stats?.libraryCount))}/></div></Panel>
    </section>

    <section className="ac-grid-2"><Panel title="Operations health" kicker="SYSTEM"><Health label="Crawler checkpoint" ok={!!crawler} detail={crawler ? `${cStatus.label} · merge ${mergeLabel.toLowerCase()}` : 'No checkpoint'} /><Health label="Analyzer checkpoint" ok={!!data?.stats?.analyzer} detail={data?.stats?.analyzer ? `Updated ${fmt(data.stats.analyzer.updatedAt)}` : 'No analyzer checkpoint'} /><Health label="R2 object visibility" ok={num(data?.stats?.storageObjects) > 0} detail={num(data?.stats?.storageObjects) > 0 ? `${num(data?.stats?.storageObjects).toLocaleString()} objects indexed` : 'R2-backed object index unavailable'} /><Health label="Missing images" ok={num(data?.stats?.missingImages) === 0} detail={num(data?.stats?.missingImages) ? `${num(data?.stats?.missingImages)} missing records` : 'No missing references reported'} /></Panel><Panel title="Quick actions" kicker="ADMIN"><div className="ac-quick-grid"><Quick label="Review newest" onClick={()=>setActive('review')}/><Quick label="Inspect crawler" onClick={()=>setActive('crawler')}/><Quick label="Check duplicates" onClick={()=>setActive('duplicates')}/><Quick label="Open activity" onClick={()=>setActive('activity')}/><Quick label="Storage health" onClick={()=>setActive('storage')}/><Quick label="System settings" onClick={()=>setActive('settings')}/></div></Panel></section>
  </>;
}

function Crawler({crawler,workers,crawlPct,cStatus,mergeLabel}:{data:Data|null;crawler:AnyRecord|null;workers:WorkerState[];cStatus:any;crawlPct:number;mergeLabel:string}) {
  return <><section className="ac-hero ac-card ac-detail-hero"><div><div className="ac-kicker">RUN CONTROL</div><h2>{cStatus.label}</h2><p>{crawler ? `Checkpoint ${fmt(crawler.updatedAt)} · source ${crawler.source || 'unknown'}` : 'No active crawler state.'}</p></div><div className="ac-detail-side"><Stat label="Merge" value={mergeLabel}/><Stat label="Safe resume" value={crawler?.nextQueryIndex != null ? Number(crawler.nextQueryIndex).toLocaleString() : '—'}/></div></section><section className="ac-card"><div className="ac-panel-head"><div><div className="ac-kicker">OVERALL PROGRESS</div><h2>{num(crawler?.nextQueryIndex).toLocaleString()} / {num(crawler?.totalQueries).toLocaleString()}</h2></div><strong className="ac-big-number">{crawlPct}%</strong></div><div className="ac-progress ac-progress-tall"><div style={{width:`${crawlPct}%`}}/></div></section><section className="ac-worker-detail-grid">{workers.length ? workers.map((w,i)=><article className="ac-worker-large" key={i}><div className="ac-worker-top"><strong>Worker {i}</strong><span className={`ac-badge ${w.status==='complete'?'good':Date.parse(String(w.updatedAt||''))>Date.now()-15*60*1000?'live':'warn'}`}>{String(w.status||'unknown')}</span></div><div className="ac-worker-large-num">{workerProgress(w)}%</div><div className="ac-mini-progress"><div style={{width:`${workerProgress(w)}%`}}/></div><div className="ac-stat-strip"><span>Next <b>{num(w.nextQueryIndex).toLocaleString()}</b></span><span>Added <b>{num(w.addedCount).toLocaleString()}</b></span><span>Dupes <b>{num(w.duplicateCount).toLocaleString()}</b></span></div><div className="ac-stat-strip"><span>Failed <b>{num(w.failedCount).toLocaleString()}</b></span><span>Found <b>{num(w.discoveredCount).toLocaleString()}</b></span><span>Updated <b>{fmt(w.updatedAt)}</b></span></div></article>) : <Empty text="No worker checkpoints found."/>}</section><section className="ac-card"><div className="ac-panel-head"><div><div className="ac-kicker">RUN ACTIONS</div><h2>Execution stays in GitHub Actions</h2></div></div><p className="ac-sub">Use GitHub Actions to start, rerun or inspect a crawler run. This panel is read-only so a moderation session cannot accidentally interrupt a crawl.</p><div className="ac-quick-grid"><a className="ac-quick" href="https://github.com/CocoShesh/bini-image-archive/actions" target="_blank" rel="noreferrer">Open Actions ↗</a><button className="ac-quick" onClick={()=>window.location.reload()}>Refresh state</button></div></section></>;
}

function ReviewOverview({counts,reviewUrl}:{counts:Counts|undefined;reviewUrl:string}) {
  const pending=num(counts?.review), fresh=num(counts?.new), noMember=num(counts?.noMember), accepted=num(counts?.accept), rejected=num(counts?.reject);
  const reviewed=accepted+rejected;
  const total=Math.max(1,pending+reviewed);
  const reviewedPct=pct(reviewed,total);
  const freshPct=pct(fresh,Math.max(1,pending));
  const noMemberPct=pct(noMember,Math.max(1,pending));
  return <>
    <section className="ac-review-hero ac-card">
      <div className="ac-review-hero-copy">
        <div className="ac-kicker">MODERATION DESK</div>
        <div className="ac-review-hero-title"><div><h2>Review queue</h2><p>Keep the newest crawler discoveries moving through moderation without losing the context around the backlog.</p></div><span className="ac-badge live"><i/> {fresh.toLocaleString()} NEW</span></div>
        <div className="ac-review-hero-actions"><a className="ac-action-primary" href={reviewUrl}>Open Review Studio →</a><button className="ac-quick" onClick={()=>window.location.reload()}>Refresh queue</button></div>
      </div>
      <div className="ac-review-hero-number"><span>Pending now</span><strong>{pending.toLocaleString()}</strong><small>items waiting for a decision</small></div>
    </section>

    <section className="ac-metrics ac-review-metrics">
      <Metric label="New discoveries" value={fresh} note="Fresh crawler output" tone="amber"/>
      <Metric label="No member" value={noMember} note="Metadata follow-up" tone="violet"/>
      <Metric label="Accepted" value={accepted} note="Manual decisions" tone="green"/>
      <Metric label="Rejected" value={rejected} note="Manual decisions" tone="red"/>
    </section>

    <section className="ac-review-grid">
      <Panel title="Queue health" kicker="TRIAGE">
        <div className="ac-queue-health">
          <div className="ac-queue-ring" style={{background:`conic-gradient(#a98d68 0 ${freshPct}%, #6f685d ${freshPct}% ${Math.min(100,freshPct+noMemberPct)}%, #2a2a2a ${Math.min(100,freshPct+noMemberPct)}% 100%)`}}><div><strong>{pending.toLocaleString()}</strong><span>pending</span></div></div>
          <div className="ac-queue-bars"><Bar label="New discoveries" value={fresh} max={Math.max(1,pending)}/><Bar label="No member" value={noMember} max={Math.max(1,pending)}/><Bar label="Reviewed" value={reviewed} max={Math.max(1,total)}/></div>
        </div>
      </Panel>
      <Panel title="Decision coverage" kicker="WORKFLOW">
        <div className="ac-coverage"><div className="ac-coverage-head"><span>Reviewed</span><strong>{reviewedPct}%</strong></div><div className="ac-progress"><div style={{width:`${reviewedPct}%`}}/></div><div className="ac-coverage-copy"><span>{accepted.toLocaleString()} accepted</span><span>{rejected.toLocaleString()} rejected</span></div></div>
        <div className="ac-review-note"><b>Recommended flow</b><span>Open newest items first, resolve obvious non-matches quickly, then spend time on low-confidence candidates.</span></div>
      </Panel>
    </section>

    <section className="ac-review-actions-grid">
      <Quick label="Review newest" onClick={()=>window.location.assign(reviewUrl)}/>
      <Quick label="Review no-member" onClick={()=>window.location.assign(`${reviewUrl}?filter=no-member`)}/>
      <Quick label="Review new discoveries" onClick={()=>window.location.assign(`${reviewUrl}?filter=new`)}/>
      <Quick label="Open crawler" onClick={()=>window.location.assign(`${reviewUrl.replace(/\/review$/, '/crawler')}`)}/>
    </section>
  </>;
}
function Library({data,counts}:{data:Data|null;counts:Counts|undefined}) { return <><section className="ac-metrics"><Metric label="Indexed" value={num(data?.stats?.libraryCount)} note="Current library"/><Metric label="Storage" value={num(data?.stats?.storageObjects)} note="R2-backed image objects"/><Metric label="No member" value={num(counts?.noMember)} note="Metadata follow-up"/><Metric label="Today" value={num(counts?.discoveredToday)} note="New discoveries"/></section><Panel title="Library health" kicker="COLLECTION"><div className="ac-health-grid"><Health label="Library file" ok={num(data?.stats?.libraryCount)>0} detail={`Updated ${fmt(data?.stats?.libraryUpdatedAt)}`}/><Health label="R2 objects" ok={num(data?.stats?.storageObjects)>0} detail={`${num(data?.stats?.storageObjects).toLocaleString()} objects reported`}/><Health label="Missing images" ok={num(data?.stats?.missingImages)===0} detail={`${num(data?.stats?.missingImages).toLocaleString()} missing`}/><Health label="Review backlog" ok={num(counts?.review) < 1500} detail={`${num(counts?.review).toLocaleString()} awaiting moderation`}/></div></Panel></>; }
function Duplicates({data}:{data:Data|null}) { const groups=num(data?.stats?.duplicateGroups), pairs=num(data?.stats?.duplicatePairs); return <><section className="ac-metrics"><Metric label="Duplicate groups" value={groups} note="Near-duplicate analysis"/><Metric label="Duplicate pairs" value={pairs} note="Compared relationships"/><Metric label="Indexed" value={num(data?.stats?.libraryCount)} note="Current library"/><Metric label="Storage" value={num(data?.stats?.storageObjects)} note="R2-backed image objects"/></section><Panel title="Duplicate operations" kicker="DEDUPLICATION"><p className="ac-sub">The analysis artifacts remain the source of truth for quarantine/canonical decisions. This control center currently exposes health and counts without destructive merge controls.</p><div className="ac-quick-grid"><button className="ac-quick" disabled>Open duplicate report</button><button className="ac-quick" disabled>Review quarantine</button></div></Panel></>; }
function Analyzer({analyzer}:{analyzer:AnyRecord|null}) { const total=num(analyzer?.total); const done=Math.max(num(analyzer?.nextStartIndex),num(analyzer?.processed),0); const progress=pct(done,total); return <><section className="ac-hero ac-card ac-detail-hero"><div><div className="ac-kicker">CPU ANALYSIS</div><h2>{analyzer ? pretty(String(analyzer.status||'checkpoint')) : 'No analyzer checkpoint'}</h2><p>{analyzer ? `Updated ${fmt(analyzer.updatedAt)}` : 'No batch checkpoint is currently available.'}</p></div><div className="ac-detail-side"><Stat label="Progress" value={`${progress}%`}/><Stat label="Next" value={analyzer?.nextStartIndex != null ? Number(analyzer.nextStartIndex).toLocaleString() : '—'}/></div></section><Panel title="Analyzer state" kicker="CHECKPOINT"><DataRows record={analyzer}/></Panel></>; }
function activityKind(item: AnyRecord) {
  const raw = String(item.category || item.kind || item.type || item.source || '').toLowerCase();
  if (raw.includes('security') || raw.includes('auth') || raw.includes('login') || raw.includes('rate') || raw.includes('attack')) return 'Security';
  if (raw.includes('crawler') || raw.includes('worker') || raw.includes('crawl')) return 'Crawler';
  if (raw.includes('analyzer') || raw.includes('analysis') || raw.includes('cpu')) return 'Analyzer';
  if (raw.includes('r2') || raw.includes('storage') || raw.includes('sync')) return 'Storage';
  if (raw.includes('admin') || raw.includes('review') || raw.includes('moder')) return 'Admin';
  return 'System';
}
function activityTone(item: AnyRecord) {
  const raw = String(item.severity || item.level || item.status || '').toLowerCase();
  if (raw.includes('critical') || raw.includes('error') || raw.includes('danger')) return 'critical';
  if (raw.includes('warn') || raw.includes('blocked') || raw.includes('suspicious')) return 'warning';
  if (raw.includes('success') || raw.includes('complete') || raw.includes('ok')) return 'success';
  return 'info';
}

function buildAlerts(data:Data|null,crawler:AnyRecord|null){
  const alerts:{tone:string;title:string;detail:string}[]=[];
  const workers:Array<AnyRecord>=Array.isArray(crawler?.workers)?crawler.workers:[];
  const paused=String(crawler?.status||'')==='paused';
  if(paused) alerts.push({tone:'warn',title:'Crawler is resumable',detail:`Next safe resume is ${num(crawler?.nextQueryIndex).toLocaleString()} of ${num(crawler?.totalQueries).toLocaleString()} queries.`});
  const stalled=workers.filter(w=>String(w.status||'')!=='complete' && (!w.updatedAt || Date.parse(String(w.updatedAt)) < Date.now()-20*60*1000));
  if(stalled.length) alerts.push({tone:'warn',title:`${stalled.length} worker${stalled.length>1?'s':''} may be stale`,detail:stalled.map(w=>`Worker ${num(w.workerId)+1}`).join(', ')});
  const review=num(data?.counts.review); if(review>0) alerts.push({tone:review>500?'warn':'info',title:`${review.toLocaleString()} images await review`,detail:`${num(data?.counts.new).toLocaleString()} are new discoveries.`});
  const missing=num(data?.stats?.missingImages); if(missing>0) alerts.push({tone:'critical',title:`${missing.toLocaleString()} missing image references`,detail:'Check Library / Storage health.'});
  const failures=workers.reduce((n,w)=>n+num(w.failedCount),0); if(failures>0) alerts.push({tone:'warn',title:`${failures.toLocaleString()} worker-level failures observed`,detail:'Review crawler errors before the next run.'});
  return alerts;
}
function AlertStrip({alerts}:{alerts:{tone:string;title:string;detail:string}[]}){return <section className="ac-alert-strip">{alerts.map((a,i)=><article className={`ac-alert ${a.tone}`} key={`${a.title}-${i}`}><i/><div><b>{a.title}</b><span>{a.detail}</span></div></article>)}</section>}
function CommandPalette({setActive,reviewUrl,close}:{setActive:(s:Section)=>void;reviewUrl:string;close:()=>void}){
  const actions=[['Go to Overview','overview'],['Open Crawler','crawler'],['Open Review Queue','review'],['Open Library','library'],['Open Duplicates','duplicates'],['Open Analyzer','analyzer'],['Open Activity','activity'],['Open Storage','storage'],['Open Settings','settings']] as const;
  return <div className="ac-palette-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)close();}}><div className="ac-palette" role="dialog" aria-modal="true"><div className="ac-palette-head"><div><div className="ac-kicker">COMMAND CENTER</div><strong>Jump to an operation</strong></div><button onClick={close}>Esc</button></div><div className="ac-palette-list">{actions.map(([label,id])=><button key={id} onClick={()=>{setActive(id);close();}}><span>{label}</span><kbd>{id}</kbd></button>)}<a href={reviewUrl}><span>Open Review Studio</span><kbd>↗</kbd></a></div></div></div>;
}
function Activity({items}:{items:AnyRecord[]}) {
  const groups = ['Security','Crawler','Analyzer','Admin','Storage','System'] as const;
  const [filter, setFilter] = useState<'All' | typeof groups[number]>('All');
  const grouped = useMemo(() => {
    const map = new Map<string, AnyRecord[]>();
    for (const g of groups) map.set(g, []);
    for (const item of items) map.get(activityKind(item))!.push(item);
    return map;
  }, [items]);
  const totals = groups.map(g => [g, grouped.get(g)?.length || 0] as const);
  const visibleGroups = filter === 'All' ? groups : [filter];
  const total = items.length;
  const securityCount = grouped.get('Security')?.length || 0;
  const latest = items[0];
  return <>
    <section className="ac-activity-topbar">
      <div>
        <div className="ac-kicker">EVENT STREAM</div>
        <h2>System activity</h2>
        <p>Persistent operational and security events collected by the admin API and observed checkpoints.</p>
      </div>
      <div className="ac-activity-topstats">
        <div><span>Events</span><strong>{total.toLocaleString()}</strong></div>
        <div><span>Security</span><strong>{securityCount.toLocaleString()}</strong></div>
        <div><span>Latest</span><strong>{latest ? fmt(latest.at || latest.updatedAt) : '—'}</strong></div>
      </div>
    </section>
    <section className="ac-activity-filterbar">
      <div className="ac-activity-filters">
        <button className={filter==='All'?'active':''} onClick={()=>setFilter('All')}>All <b>{total}</b></button>
        {totals.map(([label,count]) => <button key={label} className={filter===label?'active':''} onClick={()=>setFilter(label)}>{label} <b>{count}</b></button>)}
      </div>
      <div className="ac-activity-live-wrap"><span className="ac-activity-flow">Two-column activity board · scroll inside cards</span><span className="ac-activity-live"><i/> Auto-refresh 10s</span></div>
    </section>
    <section className="ac-activity-stream" aria-label="Activity categories">
      {visibleGroups.map(group => {
        const list = grouped.get(group) || [];
        return <section className={`ac-activity-card ac-card ${group==='Security'?'security':''}`} key={group}>
          <div className="ac-activity-card-head"><div><div className="ac-kicker">{group.toUpperCase()}</div><h2>{group} activity</h2></div><span className="ac-activity-count">{list.length}</span></div>
          {list.length ? <div className="ac-activity-list">{list.slice(0,16).map((item,i)=>{
            const tone=activityTone(item);
            return <article className="ac-activity-item" key={item.id || `${group}-${i}`}><span className={`ac-activity-marker ${tone}`}/><div className="ac-activity-body"><div className="ac-activity-row"><b>{item.title || item.label || item.type || 'Archive event'}</b><time>{fmt(item.at || item.updatedAt || item.time)}</time></div><p>{item.detail || item.message || item.description || 'No additional details.'}</p><div className="ac-activity-meta"><span>{item.source || item.category || group}</span>{item.ip ? <span>{item.ip}</span> : null}{item.endpoint ? <span>{item.endpoint}</span> : null}{item.workerId !== undefined ? <span>Worker {item.workerId}</span> : null}{item.status ? <span>{String(item.status)}</span> : null}</div></div></article>;
          })}</div> : <div className="ac-activity-empty"><strong>No {group.toLowerCase()} activity yet</strong><span>Events in this category will appear when the system records them.</span></div>}
        </section>;
      })}
    </section>
  </>;
}

function Storage({data}:{data:Data|null}) {
  const bytes=num(data?.stats?.libraryBytes), objects=num(data?.stats?.storageObjects), missing=num(data?.stats?.missingImages), indexed=num(data?.stats?.libraryCount);
  const bytesKnown=bytes>0, objectsKnown=objects>0;
  return <>
    <section className="ac-storage-hero ac-card">
      <div><div className="ac-kicker">STORAGE VISIBILITY</div><h2>Library + R2 health</h2><p>One place to tell the difference between a healthy zero and a metric that simply is not measured yet.</p></div>
      <div className={`ac-storage-state ${bytesKnown&&objectsKnown?'good':'warn'}`}><i/><strong>{bytesKnown&&objectsKnown?'FULL VISIBILITY':'PARTIAL VISIBILITY'}</strong><span>{bytesKnown&&objectsKnown?'Storage metrics are reporting.':'The current API does not report complete storage totals.'}</span></div>
    </section>
    <section className="ac-metrics ac-storage-metrics">
      <Metric label="Indexed" value={indexed} note="Library records" tone="green"/>
      <Metric label="Library size" valueLabel={bytesKnown?fmtBytes(bytes):'Not measured'} note={bytesKnown?'Estimated from records':'Metric unavailable from current API'} tone={bytesKnown?'green':'amber'}/>
      <Metric label="R2 objects" valueLabel={objectsKnown?objects.toLocaleString():'Not measured'} note={objectsKnown?'Objects reported by API':'R2-backed object index unavailable'} tone={objectsKnown?'green':'amber'}/>
      <Metric label="Missing" value={missing} note={missing?'Broken references detected':'No missing references reported'} tone={missing?'red':'green'}/>
    </section>
    <section className="ac-grid-2">
      <Panel title="Storage health" kicker="R2 / LIBRARY"><div className="ac-health-grid"><Health label="Library state" ok={indexed>0} detail={`${indexed.toLocaleString()} records · last update ${fmt(data?.stats?.libraryUpdatedAt)}`}/><Health label="R2 object index" ok={objectsKnown} detail={objectsKnown?`${objects.toLocaleString()} objects reported`:'Not measured by current API'}/><Health label="Broken references" ok={missing===0} detail={missing?`${missing.toLocaleString()} missing references`:'No missing references reported'}/><Health label="Library bytes" ok={bytesKnown} detail={bytesKnown?fmtBytes(bytes):'Not measured by current API'}/></div></Panel>
      <Panel title="Storage notes" kicker="OPERATIONS"><div className="ac-storage-notes"><div><span>Indexed records</span><strong>{indexed.toLocaleString()}</strong><p>The archive catalogue is available even when raw R2 totals are not.</p></div><div><span>Latest library update</span><strong>{fmt(data?.stats?.libraryUpdatedAt)}</strong><p>Use this timestamp to verify the library is fresh after a crawler merge.</p></div></div></Panel>
    </section>
  </>;
}
function Settings({crawler}:{crawler:AnyRecord|null}) { return <Panel title="System settings" kicker="SECURITY & RUNTIME"><div className="ac-settings-grid"><Info label="Admin session" value="HttpOnly session cookie"/><Info label="Route protection" value="Secret gate path"/><Info label="Login throttle" value="5 failed attempts / 10 min"/><Info label="Crawler execution" value="GitHub Actions"/><Info label="Crawler state" value={crawler?.source || 'Not available'}/><Info label="Dashboard refresh" value="10 seconds"/></div><div className="ac-note">Destructive crawler execution remains outside the web dashboard. Use GitHub Actions for reruns and execution controls.</div></Panel>; }

function Panel({title,kicker,children,action,onAction}:{title:string;kicker:string;children:ReactNode;action?:string;onAction?:()=>void}) { return <section className="ac-card"><div className="ac-panel-head"><div><div className="ac-kicker">{kicker}</div><h2>{title}</h2></div>{action && <button onClick={onAction}>{action}</button>}</div>{children}</section>; }
function WorkerRow({worker,index}:{worker:WorkerState;index:number}) { const p=workerProgress(worker); const tone=worker.status==='complete'?'good':Date.parse(String(worker.updatedAt||''))>Date.now()-15*60*1000?'live':'warn'; return <div className="ac-worker-row"><div className="ac-worker-label"><strong>Worker {index}</strong><span className={`ac-dot ${tone}`}/><em>{worker.status || 'unknown'}</em><b>{p}%</b></div><div className="ac-mini-progress"><div style={{width:`${p}%`}}/></div><div className="ac-worker-meta"><span>Next {num(worker.nextQueryIndex).toLocaleString()}</span><span>+{num(worker.addedCount).toLocaleString()} added</span><span>{num(worker.failedCount).toLocaleString()} failed</span></div></div>; }
function Metric({label,value,valueLabel,note,tone}:{label:string;value?:number;valueLabel?:string;note:string;tone?:string}) { return <article className={`ac-card ac-metric ${tone ? `tone-${tone}` : ''}`}><div className="ac-kicker">{label}</div><strong>{valueLabel ?? num(value).toLocaleString()}</strong><span>{note}</span></article>; }
function Stat({label,value}:{label:string;value:string}) { return <div className="ac-stat"><span>{label}</span><strong>{value}</strong></div>; }
function Legend({label,value,tone}:{label:string;value:number;tone:string}) { return <div><i className={tone}/><span>{label}</span><b>{value.toLocaleString()}</b></div>; }
function Bar({label,value,max}:{label:string;value:number;max:number}) { return <div className="ac-bar"><div className="ac-bar-head"><span>{label}</span><b>{value.toLocaleString()}</b></div><div className="ac-bar-track"><div style={{width:`${pct(value,max)}%`}}/></div></div>; }
function Health({label,ok,detail}:{label:string;ok:boolean;detail:string}) { return <div className="ac-health"><span className={`ac-health-dot ${ok?'good':'bad'}`}/><div><b>{label}</b><p>{detail}</p></div></div>; }
function Quick({label,onClick}:{label:string;onClick:()=>void}) { return <button className="ac-quick" onClick={onClick}>{label}<span>→</span></button>; }
function Info({label,value}:{label:string;value:string}) { return <div className="ac-info"><span>{label}</span><strong>{value}</strong></div>; }
function Empty({text}:{text:string}) { return <div className="ac-empty">{text}</div>; }
function DataRows({record}:{record:AnyRecord|null}) { if(!record)return <Empty text="No checkpoint data available."/>; return <div className="ac-data-list">{Object.entries(record).slice(0,20).map(([k,v])=><div className="ac-data-row" key={k}><span>{pretty(k)}</span><code>{typeof v==='object'?JSON.stringify(v):String(v)}</code></div>)}</div>; }
