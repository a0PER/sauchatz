import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Copy, Flag, Pencil, Trash2 } from 'lucide-react';
import { formatTime } from '../../lib/format';
import { getChatImageUrl } from '../../lib/images';
import type { Message, Profile } from '../../lib/types';
import { Avatar, Button, Spinner, Textarea, cx } from '../ui';

const URL_RE = /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g;

function linkify(text: string): ReactNode[] {
  return text.split(URL_RE).map((part, i) =>
    i % 2 === 1 ? (
      <a key={i} href={part} target="_blank" rel="noreferrer noopener" className="text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent">
        {part}
      </a>
    ) : (
      part
    ),
  );
}

export function ChatImage({ path, local, onOpen }: { path: string | null; local?: string; onOpen: (src: string) => void }) {
  const [src, setSrc] = useState<string | null>(local ?? null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    if (path) getChatImageUrl(path).then((u) => alive && u && setSrc(u));
    return () => { alive = false; };
  }, [path]);
  return (
    <button
      type="button"
      onClick={() => src && onOpen(src)}
      className="relative mt-1 block w-fit max-w-full overflow-hidden rounded-xl border border-line bg-surface-2"
      style={{ minWidth: loaded ? undefined : 200, minHeight: loaded ? undefined : 150 }}
    >
      {src && (
        <img
          src={src}
          alt="Shared photo"
          onLoad={() => setLoaded(true)}
          className={cx('block h-auto max-h-[320px] w-auto max-w-[min(360px,68vw)] transition-opacity', loaded ? 'opacity-100' : 'opacity-0')}
        />
      )}
      {!loaded && <span className="absolute inset-0 flex items-center justify-center"><Spinner /></span>}
    </button>
  );
}

interface Props {
  message: Message;
  sender: Profile | undefined;
  mine: boolean;
  compact: boolean;
  editing: boolean;
  enterToSend: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (body: string) => void;
  onDelete: () => void;
  onReport: () => void;
  onCopy: () => void;
  onOpenImage: (src: string) => void;
  footer?: ReactNode;
  /** Bubble layout instead of the classic list. */
  bubbles?: boolean;
  /** Compact spacing setting. */
  dense?: boolean;
  /** The next message is from the same sender (bubbles group together). */
  nextSame?: boolean;
  /** Show sender names above bubbles (groups). */
  showName?: boolean;
}

function MessageItemInner({
  message: m, sender, mine, compact, editing, enterToSend,
  onStartEdit, onCancelEdit, onSaveEdit, onDelete, onReport, onCopy, onOpenImage, footer,
  bubbles = false, dense = false, nextSame = false, showName = false,
}: Props) {
  const deleted = Boolean(m.deleted_at);
  const name = sender?.display_name ?? 'Deleted user';
  const [draft, setDraft] = useState(m.body);
  const editRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing) {
      setDraft(m.body);
      requestAnimationFrame(() => {
        const el = editRef.current;
        if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
      });
    }
  }, [editing, m.body]);

  const actionBtn = 'flex size-8 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-ink';

  const editor = (
    <div className="mt-1 w-full max-w-2xl">
      <Textarea
        ref={editRef}
        rows={Math.min(8, Math.max(2, draft.split('\n').length))}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancelEdit();
          const send = enterToSend ? e.key === 'Enter' && !e.shiftKey : e.key === 'Enter' && (e.metaKey || e.ctrlKey);
          if (send) { e.preventDefault(); if (draft.trim() || m.image_path) onSaveEdit(draft.trim()); }
        }}
      />
      <div className="mt-2 flex gap-2">
        <Button size="sm" variant="secondary" onClick={onCancelEdit}>Cancel</Button>
        <Button size="sm" onClick={() => onSaveEdit(draft.trim())} disabled={!draft.trim() && !m.image_path}>Save</Button>
      </div>
    </div>
  );

  const actions = !deleted && !editing && !m.pending && (
    <div className={cx(
      'absolute -top-3 z-10 hidden items-center gap-0.5 rounded-lg border border-line bg-surface p-0.5 shadow-panel group-hover:flex group-focus-within:flex',
      bubbles && mine ? 'left-5' : 'right-5',
    )}>
      {m.body && <button className={actionBtn} onClick={onCopy} title="Copy text" aria-label="Copy text"><Copy size={15} /></button>}
      {mine && Boolean(m.body) && <button className={actionBtn} onClick={onStartEdit} title="Edit" aria-label="Edit message"><Pencil size={15} /></button>}
      {mine && <button className={cx(actionBtn, 'hover:text-danger')} onClick={onDelete} title="Delete" aria-label="Delete message"><Trash2 size={15} /></button>}
      {!mine && sender && <button className={cx(actionBtn, 'hover:text-danger')} onClick={onReport} title="Report" aria-label="Report message"><Flag size={15} /></button>}
    </div>
  );

  /* ---------- Bubble style ---------- */
  if (bubbles) {
    const gap = compact ? (dense ? 'pt-0.5' : 'pt-1') : dense ? 'pt-2' : 'pt-3';
    return (
      <div className={cx('group relative flex gap-2 px-4 sm:px-5', mine ? 'flex-row-reverse' : '', gap, m.pending && 'opacity-70')}>
        {!mine && (
          <div className="w-8 shrink-0 self-end">
            {!nextSame && (sender ? (
              <Link to={`/u/${sender.id}`} aria-label={`View ${name}`}><Avatar src={sender.avatar_url} name={name} seed={sender.id} size={30} /></Link>
            ) : <Avatar name="?" size={30} />)}
          </div>
        )}
        <div className={cx('flex min-w-0 max-w-[78%] flex-col sm:max-w-[65%]', mine ? 'items-end' : 'items-start')}>
          {!mine && !compact && showName && (
            <span className="mb-0.5 ml-3 text-xs font-medium text-muted">{name}</span>
          )}
          {deleted ? (
            <p className="rounded-2xl border border-line px-3.5 py-2 text-sm italic text-subtle">This message was deleted</p>
          ) : editing ? editor : (
            <>
              {m.body && (
                <div
                  className={cx(
                    'whitespace-pre-wrap break-words rounded-[20px] px-3.5 py-2 text-[14.5px] leading-[1.45]',
                    mine ? 'bg-accent text-on-accent [&_a]:text-on-accent' : 'bg-surface-2 text-ink',
                    mine ? (nextSame ? 'rounded-br-md' : '') : nextSame ? 'rounded-bl-md' : '',
                  )}
                >
                  {linkify(m.body)}
                  {m.edited_at && <span className="ml-1.5 text-[11px] opacity-70">(edited)</span>}
                </div>
              )}
              {(m.image_path || m.localImage) && <ChatImage path={m.image_path} local={m.localImage} onOpen={onOpenImage} />}
            </>
          )}
          {!nextSame && <span className="mx-2 mt-0.5 text-[11px] text-subtle">{formatTime(m.created_at)}</span>}
          {footer}
        </div>
        {actions}
      </div>
    );
  }

  /* ---------- Classic style ---------- */
  return (
    <div className={cx('group relative flex gap-3 px-5 hover:bg-surface-2/60', compact ? 'pt-0.5' : dense ? 'pt-1.5' : 'pt-3', m.pending && 'opacity-70')}>
      <div className="w-9 shrink-0">
        {compact ? (
          <span className="invisible block pt-[3px] text-right text-[10px] text-subtle group-hover:visible">{formatTime(m.created_at)}</span>
        ) : sender ? (
          <Link to={`/u/${sender.id}`} aria-label={`View ${name}`}>
            <Avatar src={sender.avatar_url} name={name} seed={sender.id} size={dense ? 30 : 36} />
          </Link>
        ) : (
          <Avatar name="?" size={dense ? 30 : 36} />
        )}
      </div>
      <div className="min-w-0 flex-1 pb-0.5">
        {!compact && (
          <div className="flex items-baseline gap-2">
            {sender ? (
              <Link to={`/u/${sender.id}`} className="text-sm font-semibold text-ink hover:underline">{name}</Link>
            ) : (
              <span className="text-sm font-semibold text-muted">{name}</span>
            )}
            <span className="text-xs text-subtle">{formatTime(m.created_at)}</span>
          </div>
        )}
        {deleted ? (
          <p className="text-sm italic text-subtle">This message was deleted</p>
        ) : editing ? editor : (
          <>
            {m.body && (
              <p className="whitespace-pre-wrap break-words text-[14.5px] leading-[1.5] text-ink">
                {linkify(m.body)}
                {m.edited_at && <span className="ml-1.5 text-xs text-subtle">(edited)</span>}
              </p>
            )}
            {(m.image_path || m.localImage) && <ChatImage path={m.image_path} local={m.localImage} onOpen={onOpenImage} />}
          </>
        )}
        {footer}
      </div>
      {actions}
    </div>
  );
}

export const MessageItem = memo(MessageItemInner);
