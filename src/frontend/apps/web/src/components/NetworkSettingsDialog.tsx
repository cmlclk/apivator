import { useEffect, useId, useState } from 'react';
import { Plus, Trash2, TriangleAlert } from 'lucide-react';
import { Alert, Button, Spinner } from '@apivator/ui';
import { Dialog } from './ui/Dialog';
import { useT } from '../i18n';
import { errorMessage } from '../lib/errors';
import {
  loadNetworkSettings,
  networkStartupError,
  saveNetworkSettings,
  type NetworkSettings,
  type ProxyMode,
} from '../lib/networkSettings';

const input =
  'h-9 w-full rounded-md border border-line bg-surface px-3 font-mono text-[13px] text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20';
const lines = (value: string) => value.split(/[\n,]/);

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-[13px] font-semibold text-fg">{title}</h3>
      {children}
    </section>
  );
}

/** Masaüstü: istekleri gönderen yerel ajanın proxy, SSL ve istemci sertifikası ayarları. */
export function NetworkSettingsDialog({ onClose }: { onClose: () => void }) {
  const t = useT('shell');
  const tc = useT('common');
  const id = useId();
  const [settings, setSettings] = useState<NetworkSettings | null>(null);
  const [certCount, setCertCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startup = networkStartupError();

  useEffect(() => {
    void loadNetworkSettings().then((loaded) => {
      setSettings(loaded);
      setCertCount(loaded.clientCertificates.length);
    });
  }, []);

  const set = (patch: Partial<NetworkSettings>) => setSettings((s) => (s ? { ...s, ...patch } : s));

  async function save() {
    if (!settings) return;
    setSaving(true);
    setError(null);
    try {
      await saveNetworkSettings(settings, certCount);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setSaving(false);
    }
  }

  return (
    <Dialog
      title={t('network.title')}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {tc('actions.cancel')}
          </Button>
          <Button onClick={() => void save()} loading={saving} disabled={!settings}>
            {t('network.save')}
          </Button>
        </>
      }
    >
      {!settings ? (
        <div className="flex justify-center py-10 text-fg-subtle">
          <Spinner className="h-5 w-5" />
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <p className="text-[13px] text-fg-muted">{t('network.intro')}</p>
          {startup && !error && (
            <Alert tone="warning">{t('network.startupFailed', { error: startup })}</Alert>
          )}
          {error && <Alert tone="error">{error}</Alert>}

          <Section title="Proxy">
            <select
              aria-label="Proxy"
              value={settings.proxyMode}
              onChange={(e) => set({ proxyMode: e.target.value as ProxyMode })}
              className="h-9 w-64 rounded-md border border-line bg-surface px-2 text-sm"
            >
              <option value="System">{t('network.proxyMode.System')}</option>
              <option value="None">{t('network.proxyMode.None')}</option>
              <option value="Custom">{t('network.proxyMode.Custom')}</option>
            </select>
            {settings.proxyMode === 'Custom' && (
              <div className="grid grid-cols-2 gap-3">
                <label className="col-span-2 flex flex-col gap-1 text-[12.5px] text-fg-muted">
                  {t('network.address')}
                  <input
                    className={input}
                    value={settings.proxyUrl}
                    onChange={(e) => set({ proxyUrl: e.target.value })}
                    placeholder="http://proxy.sirket.local:8080"
                  />
                </label>
                <label className="flex flex-col gap-1 text-[12.5px] text-fg-muted">
                  {t('network.username')}
                  <input
                    className={input}
                    value={settings.proxyUsername}
                    onChange={(e) => set({ proxyUsername: e.target.value })}
                    autoComplete="off"
                  />
                </label>
                <label className="flex flex-col gap-1 text-[12.5px] text-fg-muted">
                  {t('network.password')}
                  <input
                    type="password"
                    className={input}
                    value={settings.proxyPassword}
                    onChange={(e) => set({ proxyPassword: e.target.value })}
                    autoComplete="off"
                  />
                </label>
                <label className="col-span-2 flex flex-col gap-1 text-[12.5px] text-fg-muted">
                  {t('network.bypass')}
                  <textarea
                    className={`${input} h-16 py-2`}
                    value={settings.proxyBypass.join('\n')}
                    onChange={(e) => set({ proxyBypass: lines(e.target.value) })}
                    placeholder={'localhost\n*.local\n10.*'}
                  />
                </label>
              </div>
            )}
          </Section>

          <Section title="SSL">
            <label className="flex items-center gap-2 text-[13px] text-fg">
              <input
                type="checkbox"
                checked={settings.verifySsl}
                onChange={(e) => set({ verifySsl: e.target.checked })}
                className="h-4 w-4 accent-[var(--app-accent)]"
              />
              {t('network.verifySsl')}
            </label>
            {!settings.verifySsl && (
              <p className="flex items-start gap-2 text-[12.5px] text-warning">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {t('network.verifyOffWarning')}
              </p>
            )}
            <label className="flex flex-col gap-1 text-[12.5px] text-fg-muted">
              {t('network.caCertificates')}
              <textarea
                className={`${input} h-16 py-2`}
                value={settings.caCertificatePaths.join('\n')}
                onChange={(e) => set({ caCertificatePaths: e.target.value.split('\n') })}
                placeholder="C:\Sertifikalar\sirket-ca.crt"
              />
            </label>
          </Section>

          <Section title={t('network.clientCertificates')}>
            <p className="-mt-1 text-[12.5px] text-fg-muted">{t('network.clientCertificatesHint')}</p>
            {settings.clientCertificates.map((cert, index) => {
              const update = (patch: Partial<typeof cert>) =>
                set({
                  clientCertificates: settings.clientCertificates.map((c, i) =>
                    i === index ? { ...c, ...patch } : c,
                  ),
                });
              return (
                <div
                  key={index}
                  className="grid grid-cols-[1fr_1.4fr_auto] gap-2 rounded-md border border-line p-2"
                  aria-label={t('network.certificate', { index: index + 1 })}
                  role="group"
                >
                  <input
                    className={input}
                    value={cert.host}
                    onChange={(e) => update({ host: e.target.value })}
                    placeholder="api.ornek.com"
                    aria-label={`Host ${index + 1}`}
                  />
                  <input
                    className={input}
                    value={cert.path}
                    onChange={(e) => update({ path: e.target.value })}
                    placeholder="C:\Sertifikalar\istemci.pfx"
                    aria-label={t('network.certificateFile', { index: index + 1 })}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      set({ clientCertificates: settings.clientCertificates.filter((_, i) => i !== index) })
                    }
                    aria-label={t('network.certificateRemove', { index: index + 1 })}
                    className="row-span-2 rounded p-2 text-fg-subtle hover:bg-danger/10 hover:text-danger"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                  <input
                    type="password"
                    className={input}
                    value={cert.password ?? ''}
                    onChange={(e) => update({ password: e.target.value })}
                    placeholder={t('network.certificatePasswordPlaceholder')}
                    aria-label={t('network.certificatePassword', { index: index + 1 })}
                    autoComplete="off"
                  />
                  <input
                    className={input}
                    value={cert.keyPath ?? ''}
                    onChange={(e) => update({ keyPath: e.target.value })}
                    placeholder={t('network.keyFilePlaceholder')}
                    aria-label={t('network.keyFile', { index: index + 1 })}
                  />
                </div>
              );
            })}
            <Button
              variant="secondary"
              size="sm"
              className="self-start"
              id={`${id}-add`}
              onClick={() =>
                set({
                  clientCertificates: [...settings.clientCertificates, { host: '', path: '', password: '' }],
                })
              }
            >
              <Plus className="h-3.5 w-3.5" /> {t('network.addCertificate')}
            </Button>
          </Section>
        </div>
      )}
    </Dialog>
  );
}
