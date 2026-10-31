import { useMemo, useState } from 'react';
import { Alert, Button } from '@apivator/ui';
import { buildVariableMap, normalizeAuth, type CollectionTreeDto, type RequestAuth } from '@apivator/core';
import { useVariableScopes } from '../environments/useVariables';
import { Dialog } from '../../components/ui/Dialog';
import { useT } from '../../i18n';
import { errorMessage } from '../../lib/errors';
import { AuthEditor } from '../requests/AuthEditor';

/** Collection veya klasörün yetkilendirmesi; içindeki "miras al" seçili istekler bunu kullanır. */
export function AuthSettingsDialog({
  title,
  initial,
  allowInherit,
  onSave,
  onClose,
  workspaceId,
  collection,
}: {
  workspaceId: string | undefined;
  /** Token isteğindeki değişkenler bu collection'ın ve aktif environment'ın değerleriyle çözülür. */
  collection: CollectionTreeDto | undefined;
  title: string;
  initial: RequestAuth | undefined;
  allowInherit: boolean;
  onSave: (auth: RequestAuth) => Promise<void>;
  onClose: () => void;
}) {
  const t = useT('collections');
  const [auth, setAuth] = useState(() => normalizeAuth(initial, allowInherit ? 'Inherit' : 'None'));
  const [busy, setBusy] = useState(false);
  const scopes = useVariableScopes(workspaceId, collection);
  const variables = useMemo(() => buildVariableMap(scopes.scopes), [scopes]);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await onSave(auth);
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
            {t('authSettings.cancel')}
          </Button>
          <Button loading={busy} onClick={save}>
            {t('authSettings.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-[13px] text-fg-muted">{t('authSettings.intro')}</p>
        {error && <Alert tone="error">{error}</Alert>}
        <AuthEditor
          auth={auth}
          onChange={setAuth}
          allowInherit={allowInherit}
          inheritedNote={t('authSettings.inheritedNote')}
          variables={variables}
        />
      </div>
    </Dialog>
  );
}
