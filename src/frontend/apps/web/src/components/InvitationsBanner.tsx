import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Mail } from 'lucide-react';
import { Button } from '@apivator/ui';
import { api } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { myInvitationsQueryKey, organizationsQueryKey, useMyInvitations } from '../lib/teams';
import { workspacesQueryKey } from '../lib/useWorkspaces';
import { useUi } from '../stores/ui';
import { useT } from '../i18n';

/** Bu kullanıcının e-postasına gelmiş bekleyen davetler; tek tıkla katılım. */
export function InvitationsBanner() {
  const t = useT('shell');
  const { data: invitations = [] } = useMyInvitations();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (invitations.length === 0) return null;
  const invitation = invitations[0]!;

  async function accept() {
    setBusy(invitation.id);
    setError(null);
    try {
      const accepted = await api.invitations.acceptById(invitation.id);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: workspacesQueryKey }),
        queryClient.invalidateQueries({ queryKey: organizationsQueryKey }),
        queryClient.invalidateQueries({ queryKey: myInvitationsQueryKey }),
      ]);
      if (accepted.workspaceId) useUi.getState().setCurrentWorkspaceId(accepted.workspaceId);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      role="status"
      className="flex items-center gap-3 border-b border-line bg-accent/10 px-4 py-1.5 text-[13px]"
    >
      <Mail className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">
        {t.rich(
          invitation.workspaceName
            ? 'banners.invitation.toOrganizationAndWorkspace'
            : 'banners.invitation.toOrganization',
          { b: (c) => <strong className="font-medium">{c}</strong> },
          {
            inviter: invitation.invitedByName,
            organization: invitation.organizationName,
            workspace: invitation.workspaceName,
          },
        )}
        {invitations.length > 1 && (
          <span className="text-fg-subtle">
            {' '}
            {t('banners.invitation.more', { count: invitations.length - 1 })}
          </span>
        )}
        {error && <span className="ms-2 text-danger">{error}</span>}
      </span>
      <Button size="sm" onClick={() => void accept()} loading={busy === invitation.id}>
        {t('banners.invitation.join')}
      </Button>
    </div>
  );
}
