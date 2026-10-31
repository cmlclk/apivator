import { useState, type FormEvent } from 'react';
import { Alert, Button, Input } from '@apivator/ui';
import type { MonitorDto, MonitorNotifyMode, WebhookKind } from '@apivator/core';
import { Dialog } from '../../components/ui/Dialog';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { useT } from '../../i18n';
import { selectClass } from '../../lib/teams';
import { useCollections } from '../collections/useCollections';
import { useEnvironments } from '../environments/useVariables';
import { describeSchedule, schedulePresets } from './monitorSchedule';
import { browserTimeZone } from './useMonitors';

const CUSTOM = 'custom';

/** Yeni monitör ya da var olanın ayarları. */
export function MonitorSettingsDialog({
  workspaceId,
  monitor,
  collectionId: initialCollectionId,
  onSaved,
  onClose,
}: {
  workspaceId: string;
  monitor?: MonitorDto;
  collectionId?: string;
  onSaved: (monitor: MonitorDto) => void;
  onClose: () => void;
}) {
  const t = useT('monitors');
  const { data: collections } = useCollections(workspaceId);
  const { data: environments } = useEnvironments(workspaceId);
  const [collectionId, setCollectionId] = useState(monitor?.collectionId ?? initialCollectionId ?? '');
  const [name, setName] = useState(monitor?.name ?? '');
  const [environmentId, setEnvironmentId] = useState(monitor?.environmentId ?? '');
  const initialSchedule = monitor?.schedule ?? '*/15 * * * *';
  const [preset, setPreset] = useState<string>(
    schedulePresets().some((p) => p.cron === initialSchedule) ? initialSchedule : CUSTOM,
  );
  const [cron, setCron] = useState(initialSchedule);
  const [timeZone, setTimeZone] = useState(monitor?.timeZone ?? browserTimeZone());
  const [emails, setEmails] = useState((monitor?.notifyEmails ?? []).join(', '));
  const [webhookUrl, setWebhookUrl] = useState(monitor?.webhookUrl ?? '');
  const [webhookKind, setWebhookKind] = useState<WebhookKind>(monitor?.webhookKind ?? 'Slack');
  const [notifyMode, setNotifyMode] = useState<MonitorNotifyMode>(monitor?.notifyMode ?? 'Changes');
  const [enabled, setEnabled] = useState(monitor?.enabled ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = collectionId || collections?.[0]?.id || '';
  const defaultName = collections?.find((c) => c.id === selected)?.name ?? '';
  const schedule = preset === CUSTOM ? cron : preset;

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const settings = {
      name: name.trim() || defaultName,
      environmentId: environmentId || null,
      schedule,
      timeZone: timeZone.trim() || 'UTC',
      notifyEmails: emails
        .split(/[,;\s]+/)
        .map((e) => e.trim())
        .filter(Boolean),
      webhookUrl: webhookUrl.trim() || null,
      webhookKind,
      notifyMode,
      enabled,
    };
    try {
      onSaved(
        monitor
          ? await api.monitors.update(monitor.id, settings)
          : await api.monitors.create(workspaceId, selected, settings),
      );
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={monitor ? t('settings.titleEdit', { name: monitor.name }) : t('settings.titleNew')}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('settings.cancel')}
          </Button>
          <Button
            type="submit"
            form="monitor-settings"
            loading={busy}
            disabled={!selected || !schedule.trim()}
          >
            {monitor ? t('settings.save') : t('settings.create')}
          </Button>
        </>
      }
    >
      <form id="monitor-settings" onSubmit={save} className="flex flex-col gap-4 text-[13px]">
        {!monitor && <p className="text-fg-muted">{t('settings.intro')}</p>}
        {monitor?.lastError && <Alert tone="error">{monitor.lastError}</Alert>}
        {error && <Alert tone="error">{error}</Alert>}

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            {t('settings.collection')}
            <select
              value={selected}
              disabled={Boolean(monitor)}
              onChange={(e) => setCollectionId(e.target.value)}
              className={`${selectClass} h-9`}
            >
              {collections?.length === 0 && <option value="">{t('settings.noCollections')}</option>}
              {collections?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            {t('settings.environment')}
            <select
              value={environmentId}
              onChange={(e) => setEnvironmentId(e.target.value)}
              className={`${selectClass} h-9`}
            >
              <option value="">{t('settings.none')}</option>
              {environments?.map((env) => (
                <option key={env.id} value={env.id}>
                  {env.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <Input
          label={t('settings.name')}
          placeholder={defaultName}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
        />

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            {t('settings.frequency')}
            <select
              value={preset}
              onChange={(e) => setPreset(e.target.value)}
              className={`${selectClass} h-9`}
            >
              {schedulePresets().map((p) => (
                <option key={p.cron} value={p.cron}>
                  {p.label}
                </option>
              ))}
              <option value={CUSTOM}>{t('settings.customCron')}</option>
            </select>
          </label>
          <Input
            label={t('settings.timeZone')}
            value={timeZone}
            onChange={(e) => setTimeZone(e.target.value)}
            // eslint-disable-next-line apivator/no-literal-jsx-text -- IANA saat dilimi adı örneği
            placeholder="Europe/Istanbul"
          />
        </div>
        {preset === CUSTOM && (
          <Input
            label={t('settings.cronExpression')}
            className="font-mono"
            value={cron}
            onChange={(e) => setCron(e.target.value)}
            hint={t('settings.cronHint', { description: describeSchedule(cron) })}
          />
        )}

        <fieldset className="flex flex-col gap-3 rounded-md border border-line p-3">
          <legend className="px-1 text-sm font-medium">{t('settings.notifications')}</legend>
          <Input
            label={t('settings.email')}
            placeholder={t('settings.emailPlaceholder')}
            value={emails}
            onChange={(e) => setEmails(e.target.value)}
          />
          <div className="grid grid-cols-[1fr_140px] gap-3">
            <Input
              label={t('settings.webhook')}
              placeholder="https://hooks.slack.com/services/…"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
            />
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              {t('settings.format')}
              <select
                value={webhookKind}
                onChange={(e) => setWebhookKind(e.target.value as WebhookKind)}
                className={`${selectClass} h-9`}
              >
                <option value="Slack">Slack</option>
                <option value="Teams">Teams</option>
                <option value="Generic">JSON</option>
              </select>
            </label>
          </div>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            {t('settings.when')}
            <select
              value={notifyMode}
              onChange={(e) => setNotifyMode(e.target.value as MonitorNotifyMode)}
              className={`${selectClass} h-9`}
            >
              <option value="Changes">{t('settings.whenChanges')}</option>
              <option value="EveryFailure">{t('settings.whenEvery')}</option>
            </select>
          </label>
        </fieldset>

        {monitor && (
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            <span>
              <span className="font-medium">{t('settings.enabled')}</span>
              <span className="block text-fg-subtle">
                {monitor.lastError ? t('settings.enabledAfterError') : t('settings.enabledHint')}
              </span>
            </span>
          </label>
        )}
      </form>
    </Dialog>
  );
}
