import { useEffect, useState, type ReactNode } from 'react';
import { useToast } from '../contexts/ToastContext';
import { errorMessage, supabase } from '../lib/supabase';
import { Button, Field, Modal, Textarea } from './ui';

export function ConfirmDialog({
  open, onClose, title, body, confirmLabel, danger, onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      width={420}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                onClose();
              } catch {
                /* keep the dialog open so the person can retry */
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm text-muted">{body}</div>
    </Modal>
  );
}

export function ReportDialog({ open, onClose, userId, userName, messageId }: {
  open: boolean;
  onClose: () => void;
  userId: string;
  userName: string;
  messageId?: string;
}) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!open) setReason(''); }, [open]);

  async function submit() {
    setBusy(true);
    const { error } = await supabase.from('reports').insert({
      reported_user_id: userId,
      message_id: messageId ?? null,
      reason: reason.trim(),
    });
    setBusy(false);
    if (error) return toast(errorMessage(error), 'error');
    toast('Thanks. Your report was sent to the moderators.', 'success');
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={messageId ? 'Report message' : `Report ${userName}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="danger" onClick={submit} loading={busy} disabled={!reason.trim()}>Send report</Button>
        </>
      }
    >
      <p className="mb-4 text-sm text-muted">
        Reports are private. {userName} will not be told who reported them.
      </p>
      <Field label="What is wrong?">
        <Textarea rows={4} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} placeholder="Spam, harassment, inappropriate photos..." />
      </Field>
    </Modal>
  );
}
