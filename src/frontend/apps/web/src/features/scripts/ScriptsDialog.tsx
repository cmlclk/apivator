import { useState } from 'react';
import type { ScriptSet } from '@apivator/core';
import { Alert, Button, Spinner } from '@apivator/ui';
import { Dialog } from '../../components/ui/Dialog';
import { useT } from '../../i18n';
import { errorMessage } from '../../lib/errors';
import { ScriptsEditor } from './ScriptsEditor';

/** Collection ya da klasör script'leri: içindeki her istekten önce/sonra çalışır. */
export function ScriptsDialog({
  title,
  hint,
  initial,
  readOnly,
  onSave,
  onClose,
}: {
  title: string;
  hint: string;
  initial: ScriptSet;
  readOnly: boolean;
  onSave: (scripts: ScriptSet) => Promise<void>;
  onClose: () => void;
}) {
  const t = useT('scripts');
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = value.preRequest !== initial.preRequest || value.postResponse !== initial.postResponse;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(value);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setSaving(false);
    }
  };

  return (
    <Dialog
      title={title}
      size="xl"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {readOnly ? t('close') : t('cancel')}
          </Button>
          {!readOnly && (
            <Button onClick={() => void save()} disabled={saving || !changed}>
              {saving && <Spinner className="h-3.5 w-3.5" />} {t('save')}
            </Button>
          )}
        </>
      }
    >
      {error && (
        <Alert tone="error" className="mb-3">
          {error}
        </Alert>
      )}
      <p className="mb-3 text-xs text-fg-muted">{hint}</p>
      <div className="h-[55vh]">
        <ScriptsEditor value={value} onChange={setValue} readOnly={readOnly} />
      </div>
    </Dialog>
  );
}
