import { useEffect, useRef, useState } from 'react';
import { ImagePlus, SendHorizontal, X } from 'lucide-react';
import { MAX_MESSAGE_LENGTH } from '../../config';
import { useToast } from '../../contexts/ToastContext';
import { ACCEPT_ATTR, validateImage } from '../../lib/images';
import { IconButton, cx } from '../ui';

export function Composer({
  placeholder, enterToSend, onSend, onTyping, droppedFile, onDroppedFileUsed,
}: {
  placeholder: string;
  enterToSend: boolean;
  onSend: (body: string, file: File | null) => void;
  onTyping: () => void;
  droppedFile: File | null;
  onDroppedFileUsed: () => void;
}) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);

  // Auto-grow the text box up to a limit.
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [text]);

  useEffect(() => {
    if (!file) return setPreview(null);
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function attach(f: File | null | undefined) {
    if (!f) return;
    const problem = validateImage(f);
    if (problem) return toast(problem, 'error');
    setFile(f);
    area.current?.focus();
  }

  useEffect(() => {
    if (droppedFile) {
      attach(droppedFile);
      onDroppedFileUsed();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [droppedFile]);

  function submit() {
    const body = text.trim();
    if (!body && !file) return;
    if (body.length > MAX_MESSAGE_LENGTH) return toast(`Messages can be up to ${MAX_MESSAGE_LENGTH} characters.`, 'error');
    onSend(body, file);
    setText('');
    setFile(null);
    area.current?.focus();
  }

  const canSend = Boolean(text.trim() || file);

  return (
    <div className="shrink-0 px-4 pb-4 pt-1 sm:px-5">
      <div className="rounded-3xl bg-surface-2 transition-shadow focus-within:shadow-[0_0_0_1px_var(--border-strong)]">
        {preview && (
          <div className="px-3 pt-3">
            <div className="relative inline-block">
              <img src={preview} alt="Attachment preview" className="h-24 rounded-xl border border-line object-cover" />
              <button
                onClick={() => setFile(null)}
                className="absolute -right-2 -top-2 flex size-6 items-center justify-center rounded-full bg-ink text-surface shadow"
                aria-label="Remove photo"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        )}
        <div className="flex items-end gap-1 px-1.5 py-1.5">
          <IconButton label="Add a photo" size={38} onClick={() => picker.current?.click()}>
            <ImagePlus size={20} />
          </IconButton>
          <input
            ref={picker}
            type="file"
            accept={ACCEPT_ATTR}
            hidden
            onChange={(e) => {
              attach(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <textarea
            ref={area}
            rows={1}
            value={text}
            placeholder={placeholder}
            onChange={(e) => {
              setText(e.target.value);
              if (e.target.value) onTyping();
            }}
            onPaste={(e) => {
              const img = [...e.clipboardData.files].find((f) => f.type.startsWith('image/'));
              if (img) {
                e.preventDefault();
                attach(img);
              }
            }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              const send = enterToSend ? e.key === 'Enter' && !e.shiftKey : e.key === 'Enter' && (e.metaKey || e.ctrlKey);
              if (send) {
                e.preventDefault();
                submit();
              }
            }}
            className="scroll-thin max-h-[180px] min-h-[38px] flex-1 resize-none bg-transparent px-1.5 py-[9px] text-[14.5px] leading-5 text-ink outline-none placeholder:text-muted"
          />
          <button
            onClick={submit}
            disabled={!canSend}
            aria-label="Send message"
            title={enterToSend ? 'Send (Enter)' : 'Send (Ctrl+Enter)'}
            className={cx(
              'flex size-[38px] shrink-0 items-center justify-center rounded-full transition-colors',
              canSend ? 'bg-accent text-on-accent hover:bg-accent-hover' : 'text-subtle',
            )}
          >
            <SendHorizontal size={19} />
          </button>
        </div>
      </div>
    </div>
  );
}
