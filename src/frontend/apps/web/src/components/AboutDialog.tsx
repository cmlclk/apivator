import { useEffect, useState } from 'react';
import { Button } from '@apivator/ui';
import { Dialog } from './ui/Dialog';
import { Logo } from './Logo';
import { useT } from '../i18n';
import { appVersion, isDesktop } from '../lib/desktop';
import { serverUrl } from '../lib/serverUrl';

/** Masaüstünde uygulamanın sürümü; web'de sunucunun sürümü (/health/ready). Okunamazsa null. */
async function loadVersion(): Promise<string | null> {
  try {
    if (isDesktop()) return await appVersion();
    const response = await fetch(`${serverUrl()}/health/ready`, { cache: 'no-store' });
    const body = (await response.json()) as { version?: unknown };
    return typeof body.version === 'string' ? body.version : null;
  } catch {
    return null;
  }
}

/** Hakkında: uygulama adı, sürüm numarası ve kısa açıklama. */
export function AboutDialog({ onClose }: { onClose: () => void }) {
  const t = useT('shell');
  const tc = useT('common');
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void loadVersion().then((v) => active && setVersion(v));
    return () => {
      active = false;
    };
  }, []);

  return (
    <Dialog
      title={t('about.title')}
      onClose={onClose}
      footer={
        <Button size="sm" variant="secondary" onClick={onClose} data-autofocus>
          {tc('actions.close')}
        </Button>
      }
    >
      <div className="flex flex-col items-center gap-2 py-2 text-center">
        <Logo className="h-12 w-12" />
        <p className="text-lg font-semibold tracking-tight">Apivator</p>
        {version && <p className="text-[13px] text-fg-muted">{t('about.version', { version })}</p>}
        <p className="mt-2 max-w-xs text-[13px] text-fg-muted">{t('about.description')}</p>
      </div>
    </Dialog>
  );
}
