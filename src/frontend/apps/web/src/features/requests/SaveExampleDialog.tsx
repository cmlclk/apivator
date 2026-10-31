import { useState } from 'react';
import { Alert, Button, Input, Spinner } from '@apivator/ui';
import { Dialog } from '../../components/ui/Dialog';
import { useT } from '../../i18n';
import { errorMessage } from '../../lib/errors';

/** Yanıtı örnek olarak kaydederken ad sorar. */
export function SaveExampleDialog({
  initialName,
  onSave,
  onClose,
}: {
  initialName: string;
  onSave: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const t = useT('requests');
  const [name, setName] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(name.trim());
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setSaving(false);
    }
  };

  return (
    <Dialog
      title={t('saveExample.title')}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('saveExample.cancel')}
          </Button>
          <Button onClick={() => void save()} disabled={saving || !name.trim()}>
            {saving && <Spinner className="h-3.5 w-3.5" />} {t('saveExample.save')}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        className="space-y-3"
      >
        {error && <Alert tone="error">{error}</Alert>}
        <label className="flex flex-col gap-1 text-xs text-fg-muted">
          {t('saveExample.name')}
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
        </label>
        <p className="text-xs text-fg-subtle">{t('saveExample.hint')}</p>
      </form>
    </Dialog>
  );
}
