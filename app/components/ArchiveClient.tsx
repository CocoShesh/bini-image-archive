'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ImageRecord } from '../../lib/archive';

const MEMBERS = ['All', 'Aiah', 'Colet', 'Gwen', 'Jhoanna', 'Maloi', 'Mikha', 'Stacey', 'Sheena', 'OT8'];
const PAGE_SIZE = 48;

type ApiResponse = {
  items: ImageRecord[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
  stats: { total: number; members: number; sources: number; years: number };
  years: number[];
};

function formatBytes(bytes: number) {
  if (!bytes) return '—';
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function displayUrl(image: ImageRecord) {
  return image.storageUrl || image.localPath || image.src || image.imageUrl;
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
  const [zoom, setZoom] = useState(1);
  const [copied, setCopied] = useState(false);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<ApiResponse['stats']>({ total: 0, members: 9, sources: 0, years: 0 });
  const [years, setYears] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const observerRef = useRef<HTMLDivElement | null>(null);
  const requestId = useRef(0);
  const searchTimer = useRef<number | null>(null);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('bini-archive-favorites') || '[]');
      if (Array.isArray(saved)) setFavorites(saved);
    } catch {}
  }, []);

  useEffect(() => {
    localStorage.setItem('bini-archive-favorites', JSON.stringify(favorites));
  }, [favorites]);

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
      const response = await fetch(`/api/images?${params.toString()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Request failed (${response.status})`);
      const data = await response.json() as ApiResponse;
      if (id !== requestId.current) return;
      setImages((current) => replace ? data.items : [...current, ...data.items]);
      setPage(data.page);
      setHasMore(data.hasMore);
      setTotal(data.total);
      setStats(data.stats);
      setYears(data.years);
    } catch (err) {
      if (id === requestId.current) setError(err instanceof Error ? err.message : 'Could not load the archive.');
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [activeMember, activeYear, query, sort]);

  useEffect(() => {
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(() => {
      loadPage(1, true);
    }, 280);
    return () => {
      if (searchTimer.current) window.clearTimeout(searchTimer.current);
    };
  }, [loadPage]);

  useEffect(() => {
    const node = observerRef.current;
    if (!node) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && hasMore && !loading) loadPage(page + 1, false);
    }, { rootMargin: '900px 0px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loading, loadPage, page]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key === '/' && !['INPUT', 'TEXTAREA'].includes(target?.tagName || '')) {
        event.preventDefault();
        document.getElementById('archive-search')?.focus();
      }
      if (event.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    setZoom(1);
    setCopied(false);
  }, [selected]);

  const visibleImages = useMemo(() => {
    if (!favoritesOnly) return images;
    return images.filter((image) => favorites.includes(image.id));
  }, [favorites, favoritesOnly, images]);

  const favoriteCount = favorites.length;
  const selectedIndex = selected ? visibleImages.findIndex((image) => image.id === selected.id) : -1;

  function toggleFavorite(id: string) {
    setFavorites((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  function openSelected(offset: number) {
    if (!visibleImages.length || selectedIndex < 0) return;
    const next = (selectedIndex + offset + visibleImages.length) % visibleImages.length;
    setSelected(visibleImages[next]);
  }

  async function copySource() {
    const value = sourceUrl(selected || {} as ImageRecord);
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {}
  }

  function resetFilters() {
    setQuery('');
    setActiveMember('All');
    setActiveYear('All');
    setFavoritesOnly(false);
    setSort('newest');
  }

  const activeLabel = favoritesOnly ? 'Your favorites' : activeMember === 'All' ? 'Latest discoveries' : activeMember;

  return (
    <main className="site-shell">
      <div className="ambient ambient-a" />
      <div className="ambient ambient-b" />

      <nav className="topbar">
        <a className="brand" href="#top" aria-label="BINI Archive home">
          <span className="brand-mark">B</span>
          <span><strong>BINI</strong> ARCHIVE</span>
        </a>
        <div className="top-actions">
          <a className="ghost-btn" href="#collections">Collections</a>
          <button className={`ghost-btn ${favoritesOnly ? 'ghost-active' : ''}`} onClick={() => setFavoritesOnly((value) => !value)}>♡ Favorites {favoriteCount ? `(${favoriteCount})` : ''}</button>
          <a className="ghost-btn" href="#gallery">Gallery</a>
        </div>
      </nav>

      <section className="hero" id="top">
        <div className="hero-copy">
          <div className="kicker"><span className="live-dot" /> AUTOMATIC IMAGE ARCHIVE</div>
          <h1>A home for every<br /><em>BINI moment.</em></h1>
          <p>A large, continuously growing archive with fast search, member filters, progressive loading, favorites, and direct source links.</p>
          <div className="hero-search">
            <span className="search-icon">⌕</span>
            <input id="archive-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search member, event, era, keyword..." aria-label="Search archive" />
            {query && <button className="clear-btn" onClick={() => setQuery('')} aria-label="Clear search">×</button>}
            <span className="shortcut">/</span>
            <button className="search-btn" onClick={() => document.getElementById('gallery')?.scrollIntoView({ behavior: 'smooth' })}>Search</button>
          </div>
          <div className="hero-note"><span>PROGRESSIVE INDEX</span> {stats.total.toLocaleString()} images · loading {PAGE_SIZE} at a time · {favoriteCount} saved</div>
        </div>
        <div className="hero-stats">
          <div className="hero-stat large"><span>INDEXED</span><strong>{stats.total.toLocaleString()}</strong><small>images in the archive</small></div>
          <div className="hero-stat"><strong>{stats.members}</strong><small>members & group</small></div>
          <div className="hero-stat"><strong>{stats.sources}</strong><small>source types</small></div>
        </div>
      </section>

      <section className="toolbar" id="collections">
        <div className="toolbar-left">
          <div className="filter-row">
            {MEMBERS.map((filter) => <button key={filter} className={`filter-pill ${activeMember === filter ? 'active' : ''}`} onClick={() => setActiveMember(filter)}>{filter}</button>)}
          </div>
          <div className="filter-extra-row">
            <div className="year-select-wrap">
              <span>Year</span>
              <select className="year-select" value={activeYear} onChange={(e) => setActiveYear(e.target.value)}>
                <option value="All">All years</option>
                {years.map((year) => <option key={year} value={year}>{year}</option>)}
              </select>
            </div>
            <button className={`sort-btn ${favoritesOnly ? 'sort-active' : ''}`} onClick={() => setFavoritesOnly((value) => !value)}>♡ Favorites</button>
          </div>
        </div>
        <div className="sort-wrap">
          <span>{total.toLocaleString()} matches · {images.length.toLocaleString()} loaded</span>
          <button className="sort-btn" onClick={() => setSort((value) => value === 'newest' ? 'oldest' : 'newest')}>
            {sort === 'newest' ? 'Newest first' : 'Oldest first'} <span>↕</span>
          </button>
        </div>
      </section>

      <section className="gallery-head" id="gallery">
        <div><div className="section-kicker">LIBRARY</div><h2>{activeLabel}</h2></div>
        <div className="result-count">{total.toLocaleString()} results</div>
      </section>

      {error && <div className="error-banner"><strong>Archive load failed.</strong><span>{error}</span><button className="secondary-btn" onClick={() => loadPage(page || 1, page > 1 ? false : true)}>Retry</button></div>}

      {!loading && images.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">⌁</div>
          <h3>No images found</h3>
          <p>Try another search, year, or member filter.</p>
          <button className="primary-btn" onClick={resetFilters}>Reset filters</button>
        </div>
      ) : (
        <section className="masonry-grid">
          {visibleImages.map((image) => {
            const favorite = favorites.includes(image.id);
            const url = displayUrl(image);
            return (
              <article key={image.id} className="image-card">
                <div className="image-frame">
                  <img src={url} alt={image.title || 'BINI image'} loading="lazy" decoding="async" />
                  <div className="image-badges">
                    <span>{categoryFor(image)}</span>
                    {image.year && <span>{image.year}</span>}
                    {image.member && <span>{image.member}</span>}
                  </div>
                  <div className="image-overlay">
                    <button className="card-action view-action" onClick={() => setSelected(image)}><span>View</span><b>↗</b></button>
                    <div className="card-actions-right">
                      <a className="icon-action" href={url} download aria-label="Download image" title="Download image">↓</a>
                      <button className={`icon-action ${favorite ? 'favorite-on' : ''}`} onClick={() => toggleFavorite(image.id)} aria-label="Favorite image" title="Favorite">♥</button>
                      {sourceUrl(image) && <a className="icon-action" href={sourceUrl(image)} target="_blank" rel="noreferrer" aria-label="Open source" title="Open source">↗</a>}
                    </div>
                  </div>
                </div>
                <button className="image-info" onClick={() => setSelected(image)}>
                  <div className="image-title">{image.title || 'BINI image'}</div>
                  <div className="image-sub">{image.member || image.source || 'Archive'} {image.year ? `· ${image.year}` : ''}</div>
                </button>
              </article>
            );
          })}
        </section>
      )}

      <div ref={observerRef} className="load-sentinel" aria-hidden="true" />
      <div className="load-state">
        {loading ? <><span className="spinner" /> Loading more images…</> : hasMore ? 'Scroll to keep loading the archive' : total ? `End of archive · ${total.toLocaleString()} matching images` : ''}
      </div>

      <footer className="footer"><span>BINI IMAGE ARCHIVE</span><span>{stats.total.toLocaleString()} indexed images · press / to search</span></footer>

      {selected && (
        <div className="modal-backdrop" onClick={() => setSelected(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setSelected(null)} aria-label="Close viewer">×</button>
            <div className="modal-toolbar">
              <button className="viewer-btn" onClick={() => openSelected(-1)} disabled={visibleImages.length < 2}>←</button>
              <span>{selectedIndex + 1} / {visibleImages.length}</span>
              <button className="viewer-btn" onClick={() => openSelected(1)} disabled={visibleImages.length < 2}>→</button>
            </div>
            <div className="modal-image-wrap">
              <img src={displayUrl(selected)} alt={selected.title || 'BINI image'} style={{ transform: `scale(${zoom})` }} />
            </div>
            <div className="viewer-controls">
              <button className="secondary-btn" onClick={() => setZoom((value) => Math.max(.65, +(value - .1).toFixed(2)))}>-</button>
              <span>{Math.round(zoom * 100)}%</span>
              <button className="secondary-btn" onClick={() => setZoom((value) => Math.min(2.5, +(value + .1).toFixed(2)))}>+</button>
              <button className="secondary-btn" onClick={() => setZoom(1)}>Reset zoom</button>
            </div>
            <div className="modal-content">
              <div className="modal-kicker">{categoryFor(selected)} · {selected.source || 'ARCHIVE'}</div>
              <h3>{selected.title || 'BINI image'}</h3>
              <div className="detail-grid">
                <span>Member</span><strong>{selected.member || 'Unclassified'}</strong>
                <span>Year</span><strong>{selected.year || '—'}</strong>
                <span>Type</span><strong>{categoryFor(selected)}</strong>
                <span>Resolution</span><strong>{selected.width && selected.height ? `${selected.width} × ${selected.height}` : '—'}</strong>
                <span>File size</span><strong>{formatBytes(selected.bytes)}</strong>
              </div>
              <div className="modal-actions">
                <a className="primary-btn" href={displayUrl(selected)} download>↓ Download</a>
                {sourceUrl(selected) && <a className="secondary-btn" href={sourceUrl(selected)} target="_blank" rel="noreferrer">↗ Open source</a>}
                {sourceUrl(selected) && <button className="secondary-btn" onClick={copySource}>{copied ? '✓ Copied' : 'Copy source'}</button>}
                <button className={`secondary-btn ${favorites.includes(selected.id) ? 'favorite-on-btn' : ''}`} onClick={() => toggleFavorite(selected.id)}>{favorites.includes(selected.id) ? '♥ Saved' : '♡ Save'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
