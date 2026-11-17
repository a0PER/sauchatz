import {
  forwardRef, useEffect, useRef, useState,
  type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { Loader2, X } from 'lucide-react';
import { avatarColors, initials } from '../lib/format';
import type { Presence } from '../lib/types';

function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ');
}
export { cx };

/* ---------- Buttons ---------- */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'tonal';
const variants: Record<Variant, string> = {
  primary: 'bg-accent text-on-accent hover:bg-accent-hover',
  tonal: 'bg-accent-soft text-on-accent-soft hover:brightness-[0.97] dark:hover:brightness-110',
  secondary: 'border border-line-strong bg-surface text-ink hover:bg-surface-2',
  ghost: 'text-ink hover:bg-surface-2',
  danger: 'bg-danger text-white hover:brightness-95 dark:text-[#2b0a08]',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md';
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, icon, className, children, disabled, ...rest }, ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cx(
        'inline-flex select-none items-center justify-center gap-2 rounded-full font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-55',
        size === 'sm' ? 'h-8 px-3.5 text-[13px]' : 'h-10 px-5 text-sm',
        variants[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 size={16} className="animate-spin" /> : icon}
      {children}
    </button>
  );
});

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  size?: number;
  active?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, size = 36, active, className, children, ...rest }, ref,
) {
  return (
    <button
      ref={ref}
      aria-label={label}
      title={label}
      style={{ width: size, height: size }}
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-40',
        active && 'bg-accent-soft text-on-accent-soft hover:bg-accent-soft hover:text-on-accent-soft',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});

/* ---------- Form fields ---------- */

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest }, ref,
) {
  return (
    <input
      ref={ref}
      className={cx(
        'h-11 w-full rounded-lg focus-visible:outline-none border border-line-strong bg-surface px-3.5 text-sm text-ink outline-none transition-shadow placeholder:text-subtle focus:border-accent focus:ring-1 focus:ring-accent',
        className,
      )}
      {...rest}
    />
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...rest }, ref,
) {
  return (
    <textarea
      ref={ref}
      className={cx(
        'w-full resize-none rounded-lg focus-visible:outline-none border border-line-strong bg-surface px-3.5 py-2.5 text-sm text-ink outline-none placeholder:text-subtle focus:border-accent focus:ring-1 focus:ring-accent',
        className,
      )}
      {...rest}
    />
  );
});

export function Field({ label, hint, children, counter }: { label: string; hint?: ReactNode; children: ReactNode; counter?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline justify-between text-[13px] font-medium text-ink">
        {label}
        {counter && <span className="text-xs font-normal text-subtle">{counter}</span>}
      </span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors disabled:opacity-50',
        checked ? 'bg-accent' : 'bg-line-strong',
      )}
    >
      <span
        className={cx(
          'inline-block size-[18px] rounded-full bg-white shadow transition-transform dark:bg-surface',
          checked ? 'translate-x-[19px]' : 'translate-x-[3px]',
        )}
      />
    </button>
  );
}

export function Spinner({ size = 20, className }: { size?: number; className?: string }) {
  return <Loader2 size={size} className={cx('animate-spin text-subtle', className)} />;
}

/* ---------- Avatar ---------- */

const presenceColors: Record<Presence, string> = {
  active: 'bg-success',
  away: 'bg-warning',
  dnd: 'bg-danger',
  offline: '',
};

export function Avatar({
  src, name, seed, size = 36, presence, square,
}: {
  src?: string | null;
  name: string | null | undefined;
  seed?: string;
  size?: number;
  presence?: Presence;
  square?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const [bg, fg] = avatarColors(seed || name || '?');
  const dot = Math.min(16, Math.max(9, Math.round(size * 0.28)));
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      {src && !failed ? (
        <img
          src={src}
          alt=""
          onError={() => setFailed(true)}
          className={cx('size-full object-cover', square ? 'rounded-xl' : 'rounded-full')}
          loading="lazy"
        />
      ) : (
        <span
          className={cx('flex size-full items-center justify-center font-semibold', square ? 'rounded-xl' : 'rounded-full')}
          style={{ background: bg, color: fg, fontSize: Math.max(10, size * 0.38) }}
        >
          {initials(name)}
        </span>
      )}
      {presence && presence !== 'offline' && (
        <span
          className={cx('absolute bottom-0 right-0 rounded-full ring-2 ring-surface', presenceColors[presence])}
          style={{ width: dot, height: dot, right: size > 64 ? size * 0.07 : 0, bottom: size > 64 ? size * 0.07 : 0 }}
        >
          {presence === 'dnd' && <span className="absolute left-1/2 top-1/2 h-[2px] w-1/2 -translate-x-1/2 -translate-y-1/2 rounded bg-white" />}
        </span>
      )}
    </span>
  );
}

export function PresenceDot({ presence, className }: { presence: Presence; className?: string }) {
  if (presence === 'offline') return <span className={cx('inline-block size-2.5 rounded-full border-2 border-subtle', className)} />;
  return <span className={cx('inline-block size-2.5 rounded-full', presenceColors[presence], className)} />;
}

/* ---------- Modal ---------- */

export function Modal({
  open, onClose, title, children, footer, width = 480,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const first = panel.current?.querySelector<HTMLElement>('input, textarea, button:not([data-close])');
    first?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-overlay sm:items-center sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ maxWidth: width }}
        className="animate-in flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-surface shadow-panel sm:rounded-2xl"
      >
        <div className="flex items-center justify-between px-6 pb-2 pt-5">
          <h2 className="text-[17px] font-semibold text-ink">{title}</h2>
          <IconButton label="Close" onClick={onClose} data-close size={32}>
            <X size={18} />
          </IconButton>
        </div>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-6 pb-5 pt-2">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-6 py-3.5">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/* ---------- Dropdown menu ---------- */

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  checked?: boolean;
  divider?: boolean;
}

export function Menu({
  trigger, items, align = 'right', header,
}: {
  trigger: (props: { onClick: () => void; 'aria-expanded': boolean }) => ReactNode;
  items: MenuItem[];
  align?: 'left' | 'right';
  header?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div ref={root} className="relative">
      {trigger({ onClick: () => setOpen((o) => !o), 'aria-expanded': open })}
      {open && (
        <div
          role="menu"
          className={cx(
            'animate-in absolute top-full z-40 mt-1 min-w-[220px] overflow-hidden rounded-xl border border-line bg-surface py-1.5 shadow-panel',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {header}
          {items.map((item, i) => (
            <div key={i}>
              {item.divider && <div className="my-1.5 h-px bg-line" />}
              <button
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
                className={cx(
                  'flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-surface-2',
                  item.danger ? 'text-danger' : 'text-ink',
                )}
              >
                {item.icon && <span className={cx('shrink-0', item.danger ? 'text-danger' : 'text-muted')}>{item.icon}</span>}
                <span className="flex-1">{item.label}</span>
                {item.checked && <span className="text-accent">✓</span>}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- Misc ---------- */

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <img
      src={`${import.meta.env.BASE_URL}icon-192.png`}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      className="shrink-0 rounded-[22%]"
    />
  );
}

export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-surface-2 text-muted">{icon}</div>
      <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
      {body && <p className="mt-1.5 max-w-sm text-[13px] text-muted">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function SectionLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between px-4 pb-1 pt-4">
      <span className="text-[13px] font-medium text-muted">{children}</span>
      {action}
    </div>
  );
}

