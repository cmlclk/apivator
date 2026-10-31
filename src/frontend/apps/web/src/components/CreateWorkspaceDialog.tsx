import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Input } from '@apivator/ui';
import { Dialog } from './ui/Dialog';
import { api } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { organizationsQueryKey, selectClass, useOrganizations } from '../lib/teams';
import { workspacesQueryKey } from '../lib/useWorkspaces';
import { useT } from '../i18n';
import { useUi } from '../stores/ui';

/** Takım workspace'i; kullanıcının organizasyonu yoksa önce organizasyon da oluşturulur. */
export function CreateWorkspaceDialog({
  organizationId: initialOrganizationId,
  onClose,
}: {
  organizationId?: string;
  onClose: () => void;
}) {
  const t = useT('shell');
  const tc = useT('common');
  const { data: organizations = [] } = useOrganizations();
  const teamOrgs = organizations.filter((o) => !o.isPersonal);
  const queryClient = useQueryClient();
  const [organizationId, setOrganizationId] = useState(initialOrganizationId ?? '');
  const [organizationName, setOrganizationName] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const selectedOrg = organizationId || teamOrgs[0]?.id || '';
  const needsOrganization = teamOrgs.length === 0;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      let workspaceId: string;
      if (needsOrganization) {
        // Yeni organizasyon "Genel" workspace'iyle gelir; istenen ada çevrilir.
        const org = await api.organizations.create(organizationName);
        const created = (await api.workspaces.list()).find((w) => w.organizationId === org.id)!;
        if (name.trim() && name.trim() !== created.name) await api.workspaces.rename(created.id, name);
        workspaceId = created.id;
      } else {
        workspaceId = (await api.workspaces.create(selectedOrg, name)).id;
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: workspacesQueryKey }),
        queryClient.invalidateQueries({ queryKey: organizationsQueryKey }),
      ]);
      useUi.getState().setCurrentWorkspaceId(workspaceId);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={t('createWorkspace.title')}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {tc('actions.cancel')}
          </Button>
          <Button
            type="submit"
            form="create-workspace"
            loading={busy}
            disabled={!name.trim() || (needsOrganization && !organizationName.trim())}
          >
            {t('createWorkspace.submit')}
          </Button>
        </>
      }
    >
      <form id="create-workspace" onSubmit={submit} className="flex flex-col gap-4">
        {error && <Alert tone="error">{error}</Alert>}
        {needsOrganization ? (
          <>
            <p className="text-[13px] text-fg-muted">{t('createWorkspace.orgIntro')}</p>
            <Input
              label={t('createWorkspace.orgName')}
              value={organizationName}
              onChange={(e) => setOrganizationName(e.target.value)}
              placeholder={t('createWorkspace.orgNamePlaceholder')}
              autoFocus
            />
          </>
        ) : (
          teamOrgs.length > 1 && (
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              {t('createWorkspace.organization')}
              <select
                value={selectedOrg}
                onChange={(e) => setOrganizationId(e.target.value)}
                className={`${selectClass} h-9`}
              >
                {teamOrgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
          )
        )}
        <Input
          label={t('createWorkspace.name')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('createWorkspace.namePlaceholder')}
          autoFocus={!needsOrganization}
        />
      </form>
    </Dialog>
  );
}
