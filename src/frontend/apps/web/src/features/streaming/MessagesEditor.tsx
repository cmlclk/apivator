import { useState } from 'react';
import { BookmarkPlus, FileInput, Send, Trash2 } from 'lucide-react';
import { Button, cn } from '@apivator/ui';
import { isValidBase64, resolveText, type SavedMessage, type VariableMap } from '@apivator/core';
import { useT } from '../../i18n';
import { CodeEditor } from '../requests/CodeEditor';
import { isActive, sendWebSocket, useStreams } from './streamStore';

const MAX_SAVED = 50;

function looksLikeJson(text: string) {
  const t = text.trim();
  return t.startsWith('{') || t.startsWith('[');
}

/**
 * WebSocket mesaj yazma alanı ve kayıtlı mesajlar. Mesajdaki {{değişken}}'ler gönderirken çözülür; kayıtlı
 * mesajlar isteğin tanımıyla birlikte saklanır (ekiple paylaşılır).
 */
export function MessagesEditor({
  tabId,
  messages,
  onChange,
  variables,
}: {
  tabId: string;
  messages: SavedMessage[];
  onChange: (messages: SavedMessage[]) => void;
  variables: VariableMap;
}) {
  const t = useT('streaming');
  const composer = useStreams((s) => s.composers[tabId]) ?? { text: '', binary: false };
  const setComposer = useStreams((s) => s.setComposer);
  const connected = useStreams((s) => s.sessions[tabId]?.status === 'open');
  const connecting = useStreams(
    (s) => isActive(s.sessions[tabId]) && s.sessions[tabId]?.status === 'connecting',
  );
  const [naming, setNaming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function send(text: string, binary: boolean) {
    setError(null);
    const { text: resolved, unresolved } = resolveText(text, variables);
    if (unresolved.size > 0) {
      setError(t('composer.undefinedVariable', { names: [...unresolved].map((n) => `{{${n}}}`).join(', ') }));
      return;
    }
    if (binary && !isValidBase64(resolved)) {
      setError(t('composer.invalidBase64'));
      return;
    }
    if (!sendWebSocket(tabId, resolved, binary)) setError(t('composer.connectFirst'));
  }

  function save() {
    const name = naming?.trim();
    if (!name) return;
    onChange([...messages, { name, body: composer.text, binary: composer.binary }]);
    setNaming(null);
  }

  return (
    <div className="flex h-full min-h-0 gap-3">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="min-h-24 flex-1 overflow-hidden rounded-md border border-line bg-surface">
          <CodeEditor
            value={composer.text}
            onChange={(text) => setComposer(tabId, { text })}
            language={!composer.binary && looksLikeJson(composer.text) ? 'Json' : 'none'}
            label={t('composer.messageLabel')}
            placeholder={
              composer.binary
                ? t('composer.placeholderBinary')
                : t('composer.placeholderText', { example: '{"tip": "selam"}' })
            }
          />
        </div>
        {error && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            onClick={() => send(composer.text, composer.binary)}
            disabled={!connected || !composer.text}
            title={
              connected
                ? t('composer.sendTitle')
                : connecting
                  ? t('composer.connecting')
                  : t('composer.connectFirst')
            }
          >
            <Send className="h-3.5 w-3.5" /> {t('composer.send')}
          </Button>
          <label className="flex items-center gap-1.5 text-xs text-fg-muted">
            <input
              type="checkbox"
              checked={composer.binary}
              onChange={(e) => setComposer(tabId, { binary: e.target.checked })}
            />
            {t('composer.binary')}
          </label>
          <div className="ms-auto flex items-center gap-1.5">
            {naming === null ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setNaming('')}
                disabled={!composer.text || messages.length >= MAX_SAVED}
                title={t('composer.saveTitle')}
              >
                <BookmarkPlus className="h-3.5 w-3.5" /> {t('composer.save')}
              </Button>
            ) : (
              <form
                className="flex items-center gap-1.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  save();
                }}
              >
                <input
                  autoFocus
                  value={naming}
                  onChange={(e) => setNaming(e.target.value)}
                  onKeyDown={(e) => e.key === 'Escape' && setNaming(null)}
                  placeholder={t('composer.nameLabel')}
                  aria-label={t('composer.nameLabel')}
                  maxLength={200}
                  className="h-7 w-40 rounded-md border border-line bg-surface px-2 text-xs focus:border-accent focus:outline-none"
                />
                <Button size="sm" type="submit" disabled={!naming.trim()}>
                  {t('composer.add')}
                </Button>
                <Button size="sm" variant="ghost" type="button" onClick={() => setNaming(null)}>
                  {t('composer.cancel')}
                </Button>
              </form>
            )}
          </div>
        </div>
      </div>

      <section
        aria-label={t('saved.title')}
        className="flex w-64 shrink-0 flex-col rounded-md border border-line"
      >
        <h3 className="border-b border-line px-2.5 py-1.5 text-xs font-semibold text-fg-muted">
          {t('saved.title')} {messages.length > 0 && `(${messages.length})`}
        </h3>
        {messages.length === 0 ? (
          <p className="p-3 text-xs text-fg-subtle">{t('saved.empty')}</p>
        ) : (
          <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto">
            {messages.map((m, i) => (
              <li key={i} className="group flex items-center gap-1 px-2 py-1 text-xs">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-fg">
                    {m.name}
                    {m.binary && <span className="ms-1 text-[10.5px] text-warning">{t('saved.binary')}</span>}
                  </span>
                  <span className="block truncate font-mono text-[11px] text-fg-subtle">{m.body}</span>
                </span>
                <button
                  type="button"
                  onClick={() => send(m.body, m.binary ?? false)}
                  disabled={!connected}
                  aria-label={t('saved.sendNamed', { name: m.name })}
                  title={t('saved.send')}
                  className={cn(
                    'rounded p-1 text-accent hover:bg-accent/10 disabled:text-fg-subtle disabled:hover:bg-transparent',
                  )}
                >
                  <Send className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setComposer(tabId, { text: m.body, binary: m.binary ?? false })}
                  aria-label={t('saved.editNamed', { name: m.name })}
                  title={t('saved.edit')}
                  className="rounded p-1 text-fg-subtle hover:bg-muted hover:text-fg"
                >
                  <FileInput className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onChange(messages.filter((_, j) => j !== i))}
                  aria-label={t('saved.deleteNamed', { name: m.name })}
                  title={t('saved.delete')}
                  className="rounded p-1 text-fg-subtle hover:bg-danger/10 hover:text-danger"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
