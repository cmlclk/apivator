import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { Check, Copy, FilePlus2 } from 'lucide-react';
import { Button, cn } from '@apivator/ui';
import { toCurl } from '@apivator/core';
import {
  harEntryToRequest,
  harMimeCategory,
  harResponseBody,
  prettyBody,
  type HarEntry,
  type HarPair,
} from '@apivator/core/tools';
import { useWorkspaces } from '../../../lib/useWorkspaces';
import { CodeEditor } from '../../requests/CodeEditor';
import { OpenInToolsMenu } from '../OutputActions';
import { openRequestTab } from '../requestTab';
import { formatBytes, formatMs } from './harFormat';
import { useT } from '../../../i18n';

type Section = 'request' | 'response' | 'timings';

const SECTIONS: Section[] = ['request', 'response', 'timings'];

const actionClass =
  'flex items-center gap-1 rounded px-2 py-1 text-xs text-fg-subtle hover:bg-muted hover:text-fg';

/** Seçili HAR kaydının istek, yanıt ve zamanlama ayrıntıları. */
export function HarDetail({ entry }: { entry: HarEntry }) {
  const t = useT('toolsData');
  const navigate = useNavigate();
  const { current } = useWorkspaces();
  const [section, setSection] = useState<Section>('response');
  const [copied, setCopied] = useState(false);
  const request = useMemo(() => harEntryToRequest(entry), [entry]);
  const body = useMemo(() => harResponseBody(entry), [entry]);

  const copyCurl = () =>
    void navigator.clipboard.writeText(toCurl(request)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });

  return (
    <section
      className="flex min-h-0 flex-1 flex-col rounded-md border border-line"
      aria-label={t('har.detail.region')}
    >
      <header className="flex min-h-9 flex-wrap items-center gap-2 border-b border-line px-2 py-1">
        <div role="tablist" aria-label={t('har.detail.sections')} className="flex gap-1">
          {SECTIONS.map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={section === s}
              onClick={() => setSection(s)}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs',
                section === s ? 'bg-accent/10 font-medium text-accent' : 'text-fg-muted hover:bg-muted',
              )}
            >
              {t(`har.detail.${s}`)}
            </button>
          ))}
        </div>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg-subtle" title={entry.url}>
          {entry.method} {entry.url}
        </span>
        <Button size="sm" variant="ghost" onClick={copyCurl}>
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? t('har.detail.copied') : t('har.detail.copyCurl')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={!current}
          onClick={() => openRequestTab(navigate, current!.id, request)}
        >
          <FilePlus2 className="h-3.5 w-3.5" /> {t('har.detail.openNew')}
        </Button>
        {body.text && <OpenInToolsMenu className={actionClass} getText={() => body.text} />}
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-3" role="tabpanel">
        {section === 'request' && <RequestSection entry={entry} />}
        {section === 'response' && <ResponseSection entry={entry} body={body} />}
        {section === 'timings' && <Timings entry={entry} />}
      </div>
    </section>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-4 flex flex-col gap-1">
      <h4 className="text-xs font-semibold text-fg-muted">{title}</h4>
      {children}
    </section>
  );
}

function PairTable({ title, pairs }: { title: string; pairs: HarPair[] }) {
  const t = useT('toolsData');
  if (!pairs.length) return null;
  return (
    <Block title={t('har.detail.pairsTitle', { title, count: pairs.length })}>
      <table className="w-full border-collapse font-mono text-[12px]" aria-label={title}>
        <tbody>
          {pairs.map((p, i) => (
            <tr key={i} className="align-top">
              <td className="w-1/3 border-b border-line py-0.5 pe-3 break-all text-fg-muted">{p.name}</td>
              <td className="border-b border-line py-0.5 break-all text-fg">{p.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Block>
  );
}

function BodyView({ label, text, mimeType }: { label: string; text: string; mimeType: string }) {
  const json = harMimeCategory(mimeType) === 'json' || /^\s*[[{]/.test(text);
  return (
    <div className="h-72 overflow-hidden rounded-md border border-line">
      <CodeEditor value={text} readOnly language={json ? 'Json' : 'none'} label={label} />
    </div>
  );
}

function RequestSection({ entry }: { entry: HarEntry }) {
  const t = useT('toolsData');
  const post = entry.request.postData;
  return (
    <>
      <PairTable
        title={t('har.detail.general')}
        pairs={[
          { name: t('har.detail.url'), value: entry.url },
          { name: t('har.detail.method'), value: entry.method },
          ...(entry.httpVersion ? [{ name: t('har.detail.httpVersion'), value: entry.httpVersion }] : []),
          ...(entry.serverIPAddress
            ? [{ name: t('har.detail.serverIp'), value: entry.serverIPAddress }]
            : []),
          ...(entry.startedDateTime ? [{ name: t('har.detail.started'), value: entry.startedDateTime }] : []),
        ]}
      />
      <PairTable title={t('har.detail.requestHeaders')} pairs={entry.request.headers} />
      <PairTable title={t('har.detail.queryParams')} pairs={entry.request.queryString} />
      <PairTable title={t('har.detail.requestCookies')} pairs={entry.request.cookies} />
      {post?.text ? (
        <Block
          title={
            post.mimeType
              ? t('har.detail.requestBodyWithType', { mime: post.mimeType })
              : t('har.detail.requestBody')
          }
        >
          <BodyView
            label={t('har.detail.requestBody')}
            text={prettyBody(post.text, post.mimeType)}
            mimeType={post.mimeType}
          />
        </Block>
      ) : (
        post && (
          <PairTable
            title={t('har.detail.bodyParams')}
            pairs={post.params.map((p) => ({
              name: p.name,
              value: p.fileName ? t('har.detail.fileParam', { name: p.fileName }) : p.value,
            }))}
          />
        )
      )}
    </>
  );
}

function ResponseSection({ entry, body }: { entry: HarEntry; body: ReturnType<typeof harResponseBody> }) {
  const t = useT('toolsData');
  const { content, redirectURL } = entry.response;
  return (
    <>
      <PairTable
        title={t('har.detail.general')}
        pairs={[
          {
            name: t('har.detail.status'),
            value: entry.status ? `${entry.status} ${entry.statusText}`.trim() : t('har.detail.noResponse'),
          },
          ...(content.mimeType ? [{ name: t('har.detail.type'), value: content.mimeType }] : []),
          { name: t('har.detail.size'), value: formatBytes(entry.size) },
          ...(redirectURL ? [{ name: t('har.detail.redirect'), value: redirectURL }] : []),
        ]}
      />
      <PairTable title={t('har.detail.responseHeaders')} pairs={entry.response.headers} />
      <PairTable title={t('har.detail.responseCookies')} pairs={entry.response.cookies} />
      <Block title={t('har.detail.responseBody')}>
        {body.decoded && !body.binary && (
          <p className="text-xs text-fg-subtle">{t('har.detail.base64Decoded')}</p>
        )}
        {body.binary ? (
          <p className="text-sm text-fg-muted">
            {t('har.detail.binary', {
              size: formatBytes(body.bytes),
              mime: content.mimeType || t('har.detail.unknownType'),
            })}
          </p>
        ) : body.text ? (
          <BodyView label={t('har.detail.responseBody')} text={body.text} mimeType={content.mimeType} />
        ) : (
          <p className="text-sm text-fg-muted">{t('har.detail.bodyNotSaved')}</p>
        )}
      </Block>
    </>
  );
}

function Timings({ entry }: { entry: HarEntry }) {
  const t = useT('toolsData');
  const total = Math.max(
    entry.time,
    entry.timings.reduce((sum, p) => sum + p.ms, 0),
  );
  if (!entry.timings.length) return <p className="text-sm text-fg-muted">{t('har.detail.noTimings')}</p>;
  let offset = 0;
  return (
    <table className="w-full border-collapse text-[12px]" aria-label={t('har.detail.timings')}>
      <tbody>
        {entry.timings.map((p) => {
          const left = total ? (offset / total) * 100 : 0;
          const width = total ? (p.ms / total) * 100 : 0;
          offset += p.ms;
          return (
            <tr key={p.phase}>
              <td className="w-36 py-1 pe-3 whitespace-nowrap text-fg-muted">{p.label}</td>
              <td className="py-1">
                <div className="relative h-2.5 rounded bg-muted">
                  <div
                    className="absolute h-full rounded bg-accent"
                    style={{ left: `${left}%`, width: `max(${width}%, 1px)` }}
                  />
                </div>
              </td>
              <td className="w-24 py-1 ps-3 text-end font-mono whitespace-nowrap text-fg">
                {formatMs(p.ms)}
              </td>
            </tr>
          );
        })}
        <tr>
          <td className="py-1 pe-3 font-semibold text-fg-muted">{t('har.detail.total')}</td>
          <td />
          <td className="py-1 ps-3 text-end font-mono font-semibold text-fg">{formatMs(total)}</td>
        </tr>
      </tbody>
    </table>
  );
}
