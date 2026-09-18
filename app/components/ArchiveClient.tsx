'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ImageRecord } from '../../lib/archive';
import styles from './ArchiveClient.module.css';

const MEMBERS = ['Aiah', 'Colet', 'Gwen', 'Jhoanna', 'Maloi', 'Mikha', 'Stacey', 'Sheena', 'OT8'];
const PAGE_SIZE = 48;

type ApiResponse = {
  items: ImageRecord[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
  stats: { total: number; members: number; sources: number; years: number };
  years: number[];
  memberPreviews: Record<string, string>;
};

type ReportReason = 'unrelated' | 'wrong-member' | 'duplicate' | 'low-quality' | 'wrong-content' | 'other';

const REPORT_REASONS: Array<{ id: ReportReason; label: string }> = [
  { id: 'unrelated', label: 'Unrelated / not BINI' },
  { id: 'wrong-member', label: 'Wrong member' },
  { id: 'duplicate', label: 'Duplicate' },
  { id: 'low-quality', label: 'Low quality / broken' },
  { id: 'wrong-content', label: 'Wrong content / context' },
  { id: 'other', label: 'Other' },
];

function formatBytes(bytes: number) {
  if (!bytes) return '—';
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function displayUrl(image: ImageRecord) {
  return image.storageUrl || image.localPath || image.src || image.imageUrl || '';
}

function sourceUrl(image: ImageRecord) {
  return image.pinUrl || image.sourceUrl || '';
}

function categoryFor(image: ImageRecord) {
  if (image.category) return image.category;
  const value = `${image.title} ${(image.tags || []).join(' ')}`.toLowerCase();
  if (/birthday/.test(value)) return 'Birthday';
  if (/concert|festival|tour|mall show|fan meet/.test(value)) return 'Events';
  if (/photoshoot|concept|magazine|editorial|portrait/.test(value)) return 'Photoshoot';
  if (/backstage|behind|bts|rehearsal|practice|soundcheck|recording/.test(value)) return 'BTS';
  if (/airport|arrival|departure|candid|selfie|selca/.test(value)) return 'Candid';
  if (/brand|endorsement|campaign|commercial|launch/.test(value)) return 'Brand';
  if (/award|red carpet|ceremony/.test(value)) return 'Awards';
  return 'Archive';
}

export default function ArchiveClient() {
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [query, setQuery] = useState('');
  const [activeMember, setActiveMember] = useState('All');
  const [activeYear, setActiveYear] = useState('All');
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [selected, setSelected] = useState<ImageRecord | null>(null);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<ApiResponse['stats']>({ total: 0, members: 9, sources: 0, years: 0 });
  const [years, setYears] = useState<number[]>([]);
  const [memberPreviews, setMemberPreviews] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [favoriteNotice, setFavoriteNotice] = useState('');
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState<ReportReason>('unrelated');
  const [reportNote, setReportNote] = useState('');
  const [reportBusy, setReportBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const observerRef = useRef<HTMLDivElement | null>(null);
  const requestId = useRef(0);
  const searchTimer = useRef<number | null>(null);
  const touchStartX = useRef<number | null>(null);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('bini-archive-favorites') || '[]');
      if (Array.isArray(saved)) setFavorites(saved);
    } catch {}
  }, []);

  useEffect(() => localStorage.setItem('bini-archive-favorites', JSON.stringify(favorites)), [favorites]);

  const syncUrl = useCallback(() => {
    const params = new URLSearchParams();
    if (activeMember !== 'All') params.set('member', activeMember);
    if (activeYear !== 'All') params.set('year', activeYear);
    if (query.trim()) params.set('q', query.trim());
    if (sort !== 'newest') params.set('sort', sort);
    const next = `${window.location.pathname}${params.toString() ? `?${params}` : ''}`;
    window.history.replaceState(null, '', next);
  }, [activeMember, activeYear, query, sort]);

  useEffect(() => syncUrl(), [syncUrl]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const member = params.get('member');
    const year = params.get('year');
    const q = params.get('q');
    const order = params.get('sort');
    if (member && MEMBERS.includes(member)) setActiveMember(member);
    if (year) setActiveYear(year);
    if (q) setQuery(q);
    if (order === 'oldest') setSort('oldest');
  }, []);

  const loadPage = useCallback(async (targetPage: number, replace: boolean) => {
    const id = ++requestId.current;
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        page: String(targetPage),
        limit: String(PAGE_SIZE),
        q: query.trim(),
        member: activeMember,
        year: activeYear,
        sort,
      });
      const response = await fetch(`/api/images?${params}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Request failed (${response.status})`);
      const data = await response.json() as ApiResponse;
      if (id !== requestId.current) return;
      setImages((current) => replace ? data.items : [...current, ...data.items]);
      setPage(data.page);
      setHasMore(data.hasMore);
      setTotal(data.total);
      setStats(data.stats);
      setYears(data.years);
      setMemberPreviews(data.memberPreviews || {});
    } catch (err) {
      if (id === requestId.current) setError(err instanceof Error ? err.message : 'Could not load the archive.');
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [activeMember, activeYear, query, sort]);

  useEffect(() => {
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(() => loadPage(1, true), 250);
    return () => {
      if (searchTimer.current) window.clearTimeout(searchTimer.current);
    };
  }, [loadPage]);

  useEffect(() => {
    const node = observerRef.current;
    if (!node) return;
    const observer = new IntersectionObserver((entries) => {
      if (
        entries[0]?.isIntersecting &&
        !favoritesOnly &&
        hasMore &&
        !loading
      ) {
        loadPage(page + 1, false);
      }
    }, { rootMargin: '800px 0px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [favoritesOnly, hasMore, loading, loadPage, page]);

  const visibleImages = useMemo(() => favoritesOnly ? images.filter((image) => favorites.includes(image.id)) : images, [favorites, favoritesOnly, images]);
  const selectedIndex = selected ? visibleImages.findIndex((image) => image.id === selected.id) : -1;

  const navigate = useCallback((offset: number) => {
    if (!visibleImages.length || selectedIndex < 0) return;
    const next = (selectedIndex + offset + visibleImages.length) % visibleImages.length;
    setSelected(visibleImages[next]);
  }, [selectedIndex, visibleImages]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName || '');
      if (event.key === '/' && !editing) {
        event.preventDefault();
        document.getElementById('archive-search')?.focus();
      }
      if (event.key === 'Escape') {
        setReportOpen(false);
        setSelected(null);
      }
      if (!editing && selected && event.key === 'ArrowLeft') navigate(-1);
      if (!editing && selected && event.key === 'ArrowRight') navigate(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate, selected]);

  function toggleFavorite(id: string) {
    setFavorites((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  const favoriteCount = favorites.length;

  function openFavoritesView() {
    const next = !favoritesOnly;
    setFavoritesOnly(next);

    const message = next
      ? favoriteCount
        ? `Showing ${favoriteCount} saved ${favoriteCount === 1 ? 'image' : 'images'}`
        : 'Favorites is empty — save an image to see it here'
      : 'Showing the full archive';

    setFavoriteNotice(message);
    window.setTimeout(() => setFavoriteNotice(''), 2400);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.getElementById('gallery')?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        });
      });
    });
  }

  function resetFilters() {
    setQuery('');
    setActiveMember('All');
    setActiveYear('All');
    setFavoritesOnly(false);
    setSort('newest');
  }

  function openReport(image: ImageRecord) {
    setSelected(image);
    setReportReason('unrelated');
    setReportNote('');
    setReportOpen(true);
  }

  async function submitReport() {
    if (!selected || reportBusy) return;
    setReportBusy(true);
    try {
      const response = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageId: selected.id, reason: reportReason, note: reportNote }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not send report.');
      setReportOpen(false);
      setNotice('Report sent. Thanks for helping clean the archive.');
      window.setTimeout(() => setNotice(''), 2800);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not send report.');
    } finally {
      setReportBusy(false);
    }
  }

  const activeLabel = favoritesOnly ? 'Your favorites' : activeMember === 'All' ? 'Latest discoveries' : activeMember;

  return (
    <main className="archive-app">
      <div className="ambient ambient-a" />
      <div className="ambient ambient-b" />

      <nav className="topbar">
        <a className="brand" href="#top" aria-label="BINI Archive home"><span className="brand-mark">B</span><span><strong>BINI</strong> ARCHIVE</span></a>
        <div className="top-actions"><a className="ghost-btn" href="#members">Members</a><button className={`ghost-btn ${favoritesOnly ? 'ghost-active' : ''}`} onClick={openFavoritesView}>♡ Favorites {favorites.length ? `(${favorites.length})` : ''}</button><a className="ghost-btn" href="#gallery">Gallery</a></div>
      </nav>

      <section className="hero" id="top">
        <div className="hero-copy">
          <div className="kicker"><span className="live-dot" /> AUTOMATIC IMAGE ARCHIVE</div>
          <h1>A home for every<br /><em>BINI moment.</em></h1>
          <p>A continuously growing archive with fast search, member filters, progressive loading, favorites, source links, and community reporting.</p>
          <div className="hero-search"><span className="search-icon">⌕</span><input id="archive-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search member, event, era, keyword..." aria-label="Search archive" />{query && <button className="clear-btn" onClick={() => setQuery('')} aria-label="Clear search">×</button>}<span className="shortcut">/</span><button className="search-btn" onClick={() => document.getElementById('gallery')?.scrollIntoView({ behavior: 'smooth' })}>Search</button></div>
          <div className="hero-note"><span>PROGRESSIVE INDEX</span> {stats.total.toLocaleString()} images · loading {PAGE_SIZE} at a time · {favorites.length} saved</div>
        </div>
        <div className="hero-stats"><div className="hero-stat large"><span>INDEXED</span><strong>{stats.total.toLocaleString()}</strong><small>public images</small></div><div className="hero-stat"><strong>{stats.members}</strong><small>members & group</small></div><div className="hero-stat"><strong>{stats.sources}</strong><small>source types</small></div></div>
      </section>

      <section className={styles.memberSection} id="members">
        <div className={styles.memberHead}><div><div className="section-kicker">DISCOVER</div><h2>Browse by member</h2></div><p>Curated preview picks · refreshed weekly</p></div>
        <div className={styles.memberGrid}>
          {MEMBERS.map((member) => {
            const url = memberPreviews[member];
            return <button key={member} className={styles.memberCard} onClick={() => setActiveMember(member)} aria-pressed={activeMember === member}>
              {url ? <img src={url} alt={`${member} archive preview`} loading="lazy" decoding="async" /> : <div className={styles.memberFallback}>No preview yet</div>}
              <span className={styles.memberShade} /><span className={styles.memberLabel}><strong>{member}</strong><small>{member === 'OT8' ? 'group' : 'member'}</small></span>
            </button>;
          })}
        </div>
      </section>

      <section className="toolbar" id="collections">
        <div className="toolbar-left"><div className="filter-row"><button className={`filter-pill ${activeMember === 'All' ? 'active' : ''}`} onClick={() => setActiveMember('All')}>All</button>{MEMBERS.map((filter) => <button key={filter} className={`filter-pill ${activeMember === filter ? 'active' : ''}`} onClick={() => setActiveMember(filter)}>{filter}</button>)}</div><div className="filter-extra-row"><div className="year-select-wrap"><span>Year</span><select className="year-select" value={activeYear} onChange={(e) => setActiveYear(e.target.value)}><option value="All">All years</option>{years.map((year) => <option key={year} value={year}>{year}</option>)}</select></div><button className={`sort-btn ${favoritesOnly ? 'sort-active' : ''}`} onClick={openFavoritesView}>♡ Favorites</button></div></div>
        <div className="sort-wrap"><span>{total.toLocaleString()} matches · {images.length.toLocaleString()} loaded</span><button className="sort-btn" onClick={() => setSort((value) => value === 'newest' ? 'oldest' : 'newest')}>{sort === 'newest' ? 'Newest first' : 'Oldest first'} <span>↕</span></button></div>
      </section>

      {favoritesOnly && (
        <div className="favorites-mode-bar" role="status" aria-live="polite">
          <div>
            <span className="favorites-mode-eyebrow">SAVED</span>
            <strong>Your favorites</strong>
            <small>{favoriteCount} saved {favoriteCount === 1 ? 'image' : 'images'}</small>
          </div>
          <button onClick={openFavoritesView}>Back to archive</button>
        </div>
      )}

      <section className="gallery-head" id="gallery"><div><div className="section-kicker">LIBRARY</div><h2>{activeLabel}</h2></div><div className="result-count">{total.toLocaleString()} results</div></section>
      {error && <div className="error-banner"><strong>Archive load failed.</strong><span>{error}</span><button className="secondary-btn" onClick={() => loadPage(1, true)}>Retry</button></div>}

      {!loading && images.length === 0 ? <div className="empty-state"><div className="empty-icon">⌁</div><h3>No images found</h3><p>Try another search, year, or member filter.</p><button className="primary-btn" onClick={resetFilters}>Reset filters</button></div> : (
        <section className="masonry-grid">
          {visibleImages.map((image) => {
            const favorite = favorites.includes(image.id);
            const url = displayUrl(image);
            return <article key={image.id} className="image-card" style={{ contentVisibility: 'auto', contain: 'layout style paint' }}>
              <div className="image-frame"><img src={url} alt={image.title || 'BINI archive image'} loading="lazy" decoding="async" onError={(event) => { event.currentTarget.style.display = 'none'; }} /><div className="image-badges"><span>{categoryFor(image)}</span>{image.year && <span>{image.year}</span>}{image.member && <span>{image.member}</span>}</div><div className="image-overlay"><button className="card-action view-action" onClick={() => setSelected(image)}><span>View</span><b>↗</b></button><div className="card-actions-right"><a className="icon-action" href={url} download aria-label="Download image" title="Download image">↓</a><button className={`icon-action ${favorite ? 'favorite-on' : ''}`} onClick={() => toggleFavorite(image.id)} aria-label="Favorite image" title="Favorite">♥</button><button className="icon-action" onClick={() => openReport(image)} aria-label="Report image" title="Report image">!</button>{sourceUrl(image) && <a className="icon-action" href={sourceUrl(image)} target="_blank" rel="noreferrer" aria-label="Open source" title="Open source">↗</a>}</div></div></div>
              <button className="image-info" onClick={() => setSelected(image)}><div className="image-title">{image.title || 'BINI image'}</div><div className="image-sub">{image.member || image.source || 'Archive'} {image.year ? `· ${image.year}` : ''}</div></button>
            </article>;
          })}
        </section>
      )}

      <div ref={observerRef} className="load-sentinel" aria-hidden="true" /><div className="load-state">{loading ? <><span className="spinner" /> Loading images…</> : hasMore ? 'Scroll to keep loading the archive' : total ? `End of archive · ${total.toLocaleString()} matching images` : ''}</div>
      <footer className="footer"><span>BINI IMAGE ARCHIVE</span><span>{stats.total.toLocaleString()} public images · press / to search</span></footer>

      {notice && <div role="status" aria-live="polite" className="error-banner" style={{ position: 'fixed', right: 18, bottom: 18, zIndex: 30, maxWidth: 420, borderColor: '#3b414e', background: '#11151c' }}>{notice}</div>}

      {selected && <div className="modal-backdrop" onClick={() => setSelected(null)} onTouchStart={(event) => { touchStartX.current = event.touches[0]?.clientX ?? null; }} onTouchEnd={(event) => { const start = touchStartX.current; const end = event.changedTouches[0]?.clientX ?? null; touchStartX.current = null; if (start == null || end == null) return; const delta = end - start; if (Math.abs(delta) > 50) navigate(delta > 0 ? -1 : 1); }}>
        <div className="modal" onClick={(event) => event.stopPropagation()}>
          <button className="modal-close" onClick={() => setSelected(null)} aria-label="Close viewer">×</button>
          <div className="modal-toolbar"><button className="viewer-btn" onClick={() => navigate(-1)} disabled={visibleImages.length < 2}>←</button><span>{selectedIndex + 1} / {visibleImages.length}</span><button className="viewer-btn" onClick={() => navigate(1)} disabled={visibleImages.length < 2}>→</button></div>
          <div className="modal-image-wrap"><img src={displayUrl(selected)} alt={selected.title || 'BINI archive image'} /></div>
          <div className="viewer-controls"><span className={styles.viewerMobileHint}>Swipe left/right to navigate</span></div>
          <div className="modal-content"><div className="modal-kicker">{categoryFor(selected)} · {selected.source || 'ARCHIVE'}</div><h3>{selected.title || 'BINI image'}</h3><div className="detail-grid"><span>Member</span><strong>{selected.member || 'Unclassified'}</strong><span>Year</span><strong>{selected.year || '—'}</strong><span>Type</span><strong>{categoryFor(selected)}</strong><span>Resolution</span><strong>{selected.width && selected.height ? `${selected.width} × ${selected.height}` : '—'}</strong><span>File size</span><strong>{formatBytes(selected.bytes)}</strong></div><div className="modal-actions"><a className="primary-btn" href={displayUrl(selected)} download>↓ Download</a>{sourceUrl(selected) && <a className="secondary-btn" href={sourceUrl(selected)} target="_blank" rel="noreferrer">↗ Open source</a>}<button className="secondary-btn" onClick={() => toggleFavorite(selected.id)}>{favorites.includes(selected.id) ? '♥ Saved' : '♡ Save'}</button><button className="secondary-btn" onClick={() => openReport(selected)}>Report</button></div></div>
        </div>
      </div>}

      {reportOpen && selected && <div className="modal-backdrop" onClick={() => setReportOpen(false)}><div className={styles.reportDialog} role="dialog" aria-modal="true" aria-labelledby="report-title" onClick={(event) => event.stopPropagation()}><h3 id="report-title">Report this image</h3><p>This creates a moderation report for the archive team. The original file is preserved.</p><div className={styles.reportGrid}>{REPORT_REASONS.map((reason) => <button key={reason.id} className={`${styles.reportOption} ${reportReason === reason.id ? styles.reportOptionActive : ''}`} onClick={() => setReportReason(reason.id)}>{reason.label}</button>)}</div><textarea className={styles.reportNote} value={reportNote} maxLength={500} onChange={(event) => setReportNote(event.target.value)} placeholder="Optional note (what should be fixed?)" aria-label="Optional report note" /><div className={styles.reportActions}><button className="secondary-btn" onClick={() => setReportOpen(false)} disabled={reportBusy}>Cancel</button><button className="primary-btn" onClick={submitReport} disabled={reportBusy}>{reportBusy ? 'Sending…' : 'Send report'}</button></div></div></div>}
      <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
        <a className="mobile-bottom-item active" href="#top" aria-label="Home">
          <span className="mobile-bottom-icon">⌂</span>
          <span>Home</span>
        </a>

        <a className="mobile-bottom-item" href="#members" aria-label="Members">
          <span className="mobile-bottom-icon">♢</span>
          <span>Members</span>
        </a>

        <button
          className={`mobile-bottom-item ${favoritesOnly ? 'active' : ''}`}
          onClick={openFavoritesView}
          aria-pressed={favoritesOnly}
          aria-label="Favorites"
        >
          <span className="mobile-bottom-icon">♡</span>
          <span>Favorites{favorites.length ? ` · ${favorites.length}` : ''}</span>
        </button>

        <a className="mobile-bottom-item" href="#gallery" aria-label="Gallery">
          <span className="mobile-bottom-icon">▦</span>
          <span>Gallery</span>
        </a>

        <a className="mobile-bottom-item" href="#collections" aria-label="More">
          <span className="mobile-bottom-icon">☰</span>
          <span>More</span>
        </a>
      </nav>

      {favoriteNotice && (
        <div className="favorite-toast" role="status" aria-live="polite">
          <span className="favorite-toast-icon">♡</span>
          <span>{favoriteNotice}</span>
        </div>
      )}

    </main>
  );
}
