import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Spinner } from '@apivator/ui';
import type { InvitationPreviewDto } from '@apivator/core';
import { AuthLayout } from '../components/AuthLayout';
import { translate, useT } from '../i18n';
import { api } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { myInvitationsQueryKey, organizationsQueryKey } from '../lib/teams';
import { workspacesQueryKey } from '../lib/useWorkspaces';
import { useSession } from '../stores/session';
import { useUi } from '../stores/ui';

/** E-postadaki davet bağlantısı: oturum yoksa giriş/kayıt, varsa tek tıkla kabul. */
export function InvitePage() {
  const t = useT('team');
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useSession((s) => s.user);
  const [preview, setPreview] = useState<InvitationPreviewDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    if (!token) {
      setError(translate('team', 'invite.missing'));
      return;
    }
    api.invitations
      .preview(token)
      .then(setPreview)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [token]);

  const back = `/invite?token=${encodeURIComponent(token)}`;

  async function accept() {
    setAccepting(true);
    setError(null);
    try {
      const accepted = await api.invitations.accept(token);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: workspacesQueryKey }),
        queryClient.invalidateQueries({ queryKey: organizationsQueryKey }),
        queryClient.invalidateQueries({ queryKey: myInvitationsQueryKey }),
      ]);
      if (accepted.workspaceId) useUi.getState().setCurrentWorkspaceId(accepted.workspaceId);
      navigate('/', { replace: true });
    } catch (e) {
      setError(errorMessage(e));
      setAccepting(false);
    }
  }

  const wrongAccount = user && preview && user.email.toLowerCase() !== preview.email;

  return (
    <AuthLayout title={t('invite.title')}>
      {!preview && !error && (
        <div className="flex justify-center py-8 text-fg-subtle">
          <Spinner className="h-5 w-5" />
        </div>
      )}
      {error && <Alert tone="error">{error}</Alert>}
      {preview && (
        <div className="flex flex-col gap-5">
          <p className="text-[15px] leading-relaxed">
            {t.rich(
              preview.workspaceName ? 'invite.introWorkspace' : 'invite.intro',
              { b: (c) => <strong>{c}</strong> },
              {
                inviter: preview.invitedByName,
                organization: preview.organizationName,
                workspace: preview.workspaceName ?? '',
              },
            )}
          </p>
          <p className="text-sm text-fg-muted">
            {t.rich(
              'invite.sentTo',
              { code: (c) => <span className="font-mono text-fg">{c}</span> },
              { email: preview.email },
            )}
          </p>

          {preview.status !== 'Pending' ? (
            <Alert tone="warning">{t(`invite.status.${preview.status}`)}</Alert>
          ) : user ? (
            wrongAccount ? (
              <Alert tone="warning">
                {t.rich(
                  'invite.wrongAccount',
                  { b: (c) => <strong>{c}</strong> },
                  { current: user.email, invited: preview.email },
                )}
              </Alert>
            ) : (
              <Button onClick={() => void accept()} loading={accepting}>
                {t('invite.accept')}
              </Button>
            )
          ) : preview.accountExists ? (
            <Button onClick={() => navigate(`/login?redirect=${encodeURIComponent(back)}`)}>
              {t('invite.loginJoin')}
            </Button>
          ) : (
            <div className="flex flex-col gap-2">
              <Button
                onClick={() =>
                  navigate(
                    `/register?email=${encodeURIComponent(preview.email)}&redirect=${encodeURIComponent(back)}`,
                  )
                }
              >
                {t('invite.registerJoin')}
              </Button>
              <p className="text-center text-xs text-fg-subtle">
                {t.rich('invite.haveAccount', {
                  link: (c) => (
                    <Link
                      to={`/login?redirect=${encodeURIComponent(back)}`}
                      className="text-accent hover:underline"
                    >
                      {c}
                    </Link>
                  ),
                })}
              </p>
            </div>
          )}
        </div>
      )}
    </AuthLayout>
  );
}
