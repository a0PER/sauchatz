import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { CircleAlert, CircleCheck, X } from 'lucide-react';

type Kind = 'info' | 'error' | 'success';
interface Toast { id: number; text: string; kind: Kind }

const ToastContext = createContext<(text: string, kind?: Kind) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = (id: number) => setToasts((t) => t.filter((x) => x.id !== id));

  const show = useCallback((text: string, kind: Kind = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, text, kind }]);
    setTimeout(() => dismiss(id), kind === 'error' ? 6000 : 3500);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-5 z-[100] flex flex-col items-center gap-2 px-4">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className="animate-in pointer-events-auto flex max-w-md items-center gap-2.5 rounded-lg bg-[#2b2f36] py-2.5 pl-3.5 pr-2 text-[13px] text-white shadow-panel dark:bg-[#e6e8eb] dark:text-[#1b1d21]"
          >
            {t.kind === 'error' && <CircleAlert size={16} className="shrink-0 text-[#f28b82] dark:text-[#c5221f]" />}
            {t.kind === 'success' && <CircleCheck size={16} className="shrink-0 text-[#81c995] dark:text-[#188038]" />}
            <span className="flex-1">{t.text}</span>
            <button onClick={() => dismiss(t.id)} className="rounded p-1 opacity-70 hover:opacity-100" aria-label="Dismiss">
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
