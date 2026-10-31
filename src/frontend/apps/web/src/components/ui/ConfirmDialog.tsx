import { useState, type ReactNode } from 'react';
import { Alert, Button } from '@apivator/ui';
import { useT } from '../../i18n';
import { errorMessage } from '../../lib/errors';
import { Dialog } from './Dialog';

export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const t = useT('common');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('actions.cancel')}
          </Button>
          <Button variant="danger" loading={busy} onClick={confirm} data-autofocus>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-fg-muted">
        {children}
        {error && <Alert tone="error">{error}</Alert>}
      </div>
    </Dialog>
  );
}
