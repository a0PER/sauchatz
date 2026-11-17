import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { Spinner } from '../ui';

const KEY = import.meta.env.VITE_GIPHY_KEY as string | undefined;
export const gifsEnabled = Boolean(KEY);

interface Gif {
  id: string;
  title: string;
  preview: string;
  url: string;
  width: number;
  height: number;
}

interface GiphyItem {
  id: string;
  title: string;
  images: {
    fixed_width_small?: { url: string; width: string; height: string };
    fixed_width: { url: string; width: string; height: string };
    fixed_height: { url: string };
  };
}

async function fetchGifs(query: string): Promise<Gif[]> {
  const base = query.trim()
    ? `https://api.giphy.com/v1/gifs/search?q=${encodeURIComponent(query.trim())}&`
    : 'https://api.giphy.com/v1/gifs/trending?';
  const res = await fetch(`${base}api_key=${KEY}&limit=24&rating=pg&bundle=messaging_non_clips`);
  if (!res.ok) throw new Error('GIF search is not available right now.');
  const json = (await res.json()) as { data: GiphyItem[] };
  return json.data
    .map((g) => {
      const small = g.images.fixed_width_small ?? g.images.fixed_width;
      return {
        id: g.id,
        title: g.title,
        preview: small.url,
        url: g.images.fixed_width.url.split('?')[0],
        width: Number(small.width),
        height: Number(small.height),
      };
    })
    .filter((g) => /^https:\/\/media[0-9]*\.giphy\.com\//.test(g.url));
}

export function GifPicker({ onPick, onClose }: { onPick: (url: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [gifs, setGifs] = useState<Gif[] | null>(null);
  const [error, setError] = useState('');
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => !root.current?.contains(e.target as Node) && onClose();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  useEffect(() => {
    let alive = true;
    setGifs(null);
    setError('');
    const t = setTimeout(() => {
      fetchGifs(query).then((g) => alive && setGifs(g)).catch((e) => alive && setError(e.message));
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [query]);

  return (
    <div ref={root} role="dialog" aria-label="GIF picker" className="animate-in absolute bottom-full left-0 z-40 mb-2 w-[min(360px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-line bg-surface shadow-panel">
      <div className="p-2.5">
        <div className="flex h-9 items-center gap-2 rounded-lg bg-surface-2 px-2.5">
          <Search size={15} className="shrink-0 text-subtle" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search GIFs" autoFocus className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-subtle" />
        </div>
      </div>
      <div className="scroll-thin h-[280px] overflow-y-auto px-2.5">
        {error ? (
          <p className="py-10 text-center text-sm text-muted">{error}</p>
        ) : gifs === null ? (
          <div className="flex justify-center py-10"><Spinner /></div>
        ) : gifs.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted">No GIFs found.</p>
        ) : (
          <div className="columns-2 gap-1.5">
            {gifs.map((g) => (
              <button key={g.id} onClick={() => onPick(g.url)} className="mb-1.5 block w-full overflow-hidden rounded-lg bg-surface-2" title={g.title}>
                <img src={g.preview} alt={g.title} loading="lazy" className="block w-full" style={{ aspectRatio: `${g.width} / ${g.height}` }} />
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="border-t border-line px-3 py-1.5 text-right text-[10px] font-semibold uppercase tracking-wide text-subtle">Powered by GIPHY</div>
    </div>
  );
}
