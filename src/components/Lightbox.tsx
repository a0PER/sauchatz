import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Download, X } from 'lucide-react';

export interface LightboxItem {
  src: string;
  caption?: string;
  meta?: ReactNode;
  actions?: ReactNode;
}

/** Full screen photo viewer with arrow key and swipe navigation. */
export function Lightbox({ items, index, onClose, onIndexChange }: {
  items: LightboxItem[];
  index: number | null;
  onClose: () => void;
  onIndexChange: (i: number) => void;
}) {
  const [touchX, setTouchX] = useState<number | null>(null);
  const open = index !== null && items[index] !== undefined;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' && index! < items.length - 1) onIndexChange(index! + 1);
      if (e.key === 'ArrowLeft' && index! > 0) onIndexChange(index! - 1);
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, index, items.length, onClose, onIndexChange]);

  if (!open) return null;
  const item = items[index!];
  const hasPrev = index! > 0;
  const hasNext = index! < items.length - 1;
  const navBtn = 'absolute top-1/2 hidden -translate-y-1/2 items-center justify-center rounded-full bg-white/10 p-2.5 text-white backdrop-blur hover:bg-white/20 sm:flex';

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-[rgb(10_11_14/0.94)]"
      onTouchStart={(e) => setTouchX(e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touchX === null) return;
        const dx = e.changedTouches[0].clientX - touchX;
        if (dx < -50 && hasNext) onIndexChange(index! + 1);
        if (dx > 50 && hasPrev) onIndexChange(index! - 1);
        setTouchX(null);
      }}
    >
      <div className="flex h-14 shrink-0 items-center justify-between px-4 text-white/90">
        <div className="text-sm">{items.length > 1 && `${index! + 1} of ${items.length}`}</div>
        <div className="flex items-center gap-1">
          {item.actions}
          <a href={item.src} target="_blank" rel="noreferrer" download className="rounded-full p-2 hover:bg-white/10" aria-label="Open original">
            <Download size={20} />
          </a>
          <button onClick={onClose} className="rounded-full p-2 hover:bg-white/10" aria-label="Close">
            <X size={22} />
          </button>
        </div>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-4 sm:px-20" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <img key={item.src} src={item.src} alt={item.caption || ''} className="animate-in max-h-full max-w-full rounded-lg object-contain" />
        {hasPrev && (
          <button className={`${navBtn} left-4`} onClick={() => onIndexChange(index! - 1)} aria-label="Previous photo">
            <ChevronLeft size={24} />
          </button>
        )}
        {hasNext && (
          <button className={`${navBtn} right-4`} onClick={() => onIndexChange(index! + 1)} aria-label="Next photo">
            <ChevronRight size={24} />
          </button>
        )}
      </div>
      <div className="min-h-16 shrink-0 px-6 pb-6 pt-3 text-center">
        {item.caption && <p className="mx-auto max-w-2xl whitespace-pre-wrap text-[15px] text-white">{item.caption}</p>}
        {item.meta && <div className="mt-1 text-xs text-white/60">{item.meta}</div>}
      </div>
    </div>,
    document.body,
  );
}
