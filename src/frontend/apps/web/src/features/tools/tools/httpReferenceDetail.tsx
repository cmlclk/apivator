import type { ReactNode } from 'react';
import { cn } from '@apivator/ui';
import { type HttpHeaderInfo, type HttpStatusInfo, type MimeTypeInfo } from '@apivator/core/tools';
import { CopyButton } from '../../../components/ui/CopyButton';
import { useT } from '../../../i18n';

/** Durum sınıfına göre renk. */
function statusTone(code: number): string {
  if (code >= 500) return 'text-danger';
  if (code >= 400) return 'text-warning';
  if (code >= 300) return 'text-accent';
  if (code >= 200) return 'text-success';
  return 'text-fg-muted';
}

/** Sınıfına göre renklendirilmiş durum kodu (liste ve ayrıntı başlığında). */
export function StatusCode({ code, className }: { code: number; className?: string }) {
  return <span className={cn(statusTone(code), className)}>{code}</span>;
}

function Row({ label, value, copy = false }: { label: string; value: string; copy?: boolean }) {
  const t = useT('toolsMisc');
  if (!value) return null;
  return (
    <div className="flex items-start gap-2 border-b border-line px-3 py-2 last:border-b-0">
      <span className="w-28 shrink-0 text-xs text-fg-muted">{label}</span>
      <span
        className={cn('min-w-0 flex-1 text-[13px] break-words text-fg', copy && 'font-mono text-[12.5px]')}
      >
        {value}
      </span>
      {copy && <CopyButton text={value} label={t('shared.copyRow', { label })} compact />}
    </div>
  );
}

function Panel({ title, subtitle, children }: { title: ReactNode; subtitle: string; children: ReactNode }) {
  const t = useT('toolsMisc');
  return (
    <section className="flex flex-col rounded-md border border-line" aria-label={t('httpReference.detail')}>
      <header className="border-b border-line px-3 py-2">
        <h3 className="font-mono text-sm font-semibold break-all">{title}</h3>
        <p className="text-xs text-fg-muted">{subtitle}</p>
      </header>
      {children}
    </section>
  );
}

export function StatusDetail({ status }: { status: HttpStatusInfo }) {
  const t = useT('toolsMisc');
  return (
    <Panel
      title={
        <>
          <StatusCode code={status.code} /> <span className={statusTone(status.code)}>{status.phrase}</span>
        </>
      }
      subtitle={`${status.name} · ${t(`httpReference.statusClasses.${status.statusClass}`)}`}
    >
      <Row label={t('httpReference.description')} value={status.description} />
      <Row label={t('httpReference.usage')} value={status.usage} />
      <Row label={t('httpReference.note')} value={status.note ?? ''} />
      <Row label={t('httpReference.statusLine')} value={`HTTP/1.1 ${status.code} ${status.phrase}`} copy />
      <Row label={t('httpReference.source')} value={status.reference} />
    </Panel>
  );
}

export function HeaderDetail({ header }: { header: HttpHeaderInfo }) {
  const t = useT('toolsMisc');
  return (
    <Panel
      title={header.name}
      subtitle={`${t(`httpReference.directions.${header.direction}`)} · ${header.group}`}
    >
      <Row label={t('httpReference.description')} value={header.description} />
      <Row label={t('httpReference.example')} value={`${header.name}: ${header.example}`} copy />
      <Row label={t('httpReference.source')} value={header.reference} />
    </Panel>
  );
}

export function MimeDetail({ mime }: { mime: MimeTypeInfo }) {
  const t = useT('toolsMisc');
  return (
    <Panel
      title={mime.type}
      subtitle={mime.textLike ? t('httpReference.textBased') : t('httpReference.binary')}
    >
      <Row label={t('httpReference.description')} value={mime.description} />
      <Row
        label={t('httpReference.extensions')}
        value={
          mime.extensions.length
            ? mime.extensions.map((e) => `.${e}`).join(', ')
            : t('httpReference.noExtensions')
        }
      />
      <Row
        label={t('httpReference.compression')}
        value={mime.compressible ? t('httpReference.compressible') : t('httpReference.notCompressible')}
      />
      <Row
        label="Content-Type"
        value={`Content-Type: ${mime.type}${mime.textLike && !mime.type.startsWith('multipart/') ? '; charset=utf-8' : ''}`}
        copy
      />
    </Panel>
  );
}
