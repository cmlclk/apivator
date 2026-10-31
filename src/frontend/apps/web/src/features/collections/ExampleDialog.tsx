import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { Alert, Button, Input, Spinner } from '@apivator/ui';
import { prettyJson, type ExampleDto, type KeyValueItem, type RawLanguage } from '@apivator/core';
import { Dialog } from '../../components/ui/Dialog';
import { useT } from '../../i18n';
import { SegmentedTabs } from '../../components/ui/SegmentedTabs';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { CodeEditor } from '../requests/CodeEditor';
import { KeyValueEditor } from '../requests/KeyValueEditor';
import { collectionsQueryKey } from './useCollections';

function languageOf(headers: KeyValueItem[]): RawLanguage | 'none' {
  const ct = headers.find((h) => h.key.toLowerCase() === 'content-type')?.value.toLowerCase() ?? '';
  if (ct.includes('json')) return 'Json';
  if (ct.includes('html')) return 'Html';
  if (ct.includes('xml')) return 'Xml';
  return 'none';
}

/** Kayıtlı örnek yanıtı görüntüler ve düzenler (ad, durum kodu, header'lar, body). */
export function ExampleDialog({
  exampleId,
  workspaceId,
  readOnly,
  onClose,
}: {
  exampleId: string;
  workspaceId: string;
  readOnly: boolean;
  onClose: () => void;
}) {
  const t = useT('collections');
  const queryClient = useQueryClient();
  const [example, setExample] = useState<ExampleDto | null>(null);
  const [draft, setDraft] = useState<{
    name: string;
    status: string;
    headers: KeyValueItem[];
    body: string;
  } | null>(null);
  const [section, setSection] = useState<'body' | 'headers' | 'request'>('body');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.examples
      .get(exampleId)
      .then((loaded) => {
        if (cancelled) return;
        setExample(loaded);
        const pretty = prettyJson(loaded.body);
        setDraft({
          name: loaded.name,
          status: String(loaded.status),
          headers: loaded.headers,
          body: pretty.isJson ? pretty.text : loaded.body,
        });
      })
      .catch((e: unknown) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [exampleId]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: collectionsQueryKey(workspaceId) });

  const save = async () => {
    if (!draft) return;
    const status = Number.parseInt(draft.status, 10);
    if (!draft.name.trim()) return setError(t('example.errors.nameRequired'));
    if (!(status >= 100 && status <= 599)) return setError(t('example.errors.statusRange'));
    setSaving(true);
    setError(null);
    try {
      await api.examples.update(exampleId, {
        name: draft.name,
        status,
        headers: draft.headers,
        body: draft.body,
      });
      await refresh();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setSaving(true);
    try {
      await api.examples.remove(exampleId);
      await refresh();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setSaving(false);
    }
  };

  return (
    <Dialog
      title={example ? t('example.title', { name: example.name }) : t('example.titleEmpty')}
      size="xl"
      onClose={onClose}
      footer={
        draft && (
          <>
            {!readOnly && (
              <Button
                variant="ghost"
                className="me-auto text-danger"
                onClick={() => void remove()}
                disabled={saving}
              >
                <Trash2 className="h-3.5 w-3.5" /> {t('example.delete')}
              </Button>
            )}
            <Button variant="secondary" onClick={onClose}>
              {readOnly ? t('example.close') : t('example.cancel')}
            </Button>
            {!readOnly && (
              <Button onClick={() => void save()} disabled={saving}>
                {saving && <Spinner className="h-3.5 w-3.5" />} {t('example.save')}
              </Button>
            )}
          </>
        )
      }
    >
      {error && (
        <Alert tone="error" className="mb-3">
          {error}
        </Alert>
      )}
      {!draft ? (
        !error && (
          <div className="flex justify-center py-10">
            <Spinner className="h-5 w-5" />
          </div>
        )
      ) : (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-[1fr_8rem] gap-3">
            <label className="flex flex-col gap-1 text-xs text-fg-muted">
              {t('example.name')}
              <Input
                value={draft.name}
                readOnly={readOnly}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-fg-muted">
              {t('example.status')}
              <Input
                value={draft.status}
                readOnly={readOnly}
                inputMode="numeric"
                onChange={(e) =>
                  setDraft({ ...draft, status: e.target.value.replace(/\D/g, '').slice(0, 3) })
                }
              />
            </label>
          </div>
          <div className="border-b border-line">
            <SegmentedTabs
              label={t('example.sections')}
              value={section}
              onChange={setSection}
              tabs={[
                { id: 'body', label: 'Body' },
                { id: 'headers', label: 'Headers', badge: draft.headers.length || null },
                { id: 'request', label: t('example.request') },
              ]}
            />
          </div>
          {section === 'body' && (
            <div className="h-80 overflow-hidden rounded-md border border-line bg-surface">
              <CodeEditor
                value={draft.body}
                onChange={readOnly ? undefined : (body) => setDraft({ ...draft, body })}
                readOnly={readOnly}
                language={languageOf(draft.headers)}
                label={t('example.bodyLabel')}
              />
            </div>
          )}
          {section === 'headers' && (
            <KeyValueEditor
              items={draft.headers}
              onChange={(headers) => !readOnly && setDraft({ ...draft, headers })}
              label={t('example.headersLabel')}
              allowDisable={false}
            />
          )}
          {section === 'request' && example && (
            <div className="space-y-2 text-[13px]">
              <p className="font-mono">
                <span className="font-semibold">{example.request.method}</span> {example.request.url}
              </p>
              <p className="text-xs text-fg-subtle">{t('example.requestHint')}</p>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
