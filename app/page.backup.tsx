import fs from 'node:fs/promises';
import path from 'node:path';
import { readLibrary } from '../lib/archive';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const images = await readLibrary();
  const members = ['Aiah','Colet','Gwen','Jhoanna','Maloi','Mikha','Stacey','Sheena','OT8'];
  return (
    <main className="container">
      <header className="header">
        <div>
          <div className="eyebrow">BINI IMAGE ARCHIVE · AUTOMATIC CRAWLER</div>
          <h1>One library. Every discoverable image.</h1>
          <div className="subtitle">The archive continuously expands from configured public sources. Images are stored once, deduplicated by SHA-256, and shown here with their source metadata.</div>
        </div>
        <div className="stats"><div className="stat">{images.length} images</div><div className="stat">9 groups</div></div>
      </header>
      <input className="search" placeholder="Search coming next…" />
      <div className="controls">{members.map(m => <span key={m} className="chip">{m}</span>)}</div>
      <div className="section-title"><h2>Latest discoveries</h2><span className="eyebrow">local archive</span></div>
      {images.length === 0 ? <div className="empty">No images yet. Run <b>npm run crawl:all</b> after installing Playwright Chromium.</div> : <div className="gallery">{images.map(img => <article className="card" key={img.id}><img src={img.localPath} alt={img.title} loading="lazy"/><div className="meta">{img.title}<br />{img.source}</div></article>)}</div>}
    </main>
  );
}
