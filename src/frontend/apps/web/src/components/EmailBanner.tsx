import { useState } from 'react';
import { MailWarning } from 'lucide-react';
import { api } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { useSession } from '../stores/session';
import { useT } from '../i18n';

export function EmailBanner() {
  const t = useT('shell');
  const user = useSession((s) => s.user);
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | string>('idle');

  if (!user || user.emailConfirmed) return null;

  async function resend() {
    setState('sending');
    try {
      await api.auth.resendConfirmation();
      setState('sent');
    } catch (e) {
      setState(errorMessage(e));
    }
  }

  return (
    <div className="flex items-center gap-2 border-b border-warning/30 bg-warning/10 px-4 py-1.5 text-xs">
      <MailWarning className="h-3.5 w-3.5 text-warning" aria-hidden="true" />
      <span>
        {t.rich(
          'banners.email.unverified',
          { b: (c) => <strong className="font-medium">{c}</strong> },
          { email: user.email },
        )}
      </span>
      {state === 'sent' ? (
        <span className="text-success">{t('banners.email.sent')}</span>
      ) : (
        <button
          type="button"
          onClick={resend}
          disabled={state === 'sending'}
          className="font-medium text-accent hover:underline disabled:opacity-50"
        >
          {t('banners.email.resend')}
        </button>
      )}
      {state !== 'idle' && state !== 'sending' && state !== 'sent' && (
        <span className="text-danger">{state}</span>
      )}
    </div>
  );
}
