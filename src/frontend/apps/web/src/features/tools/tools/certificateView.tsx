import type { ReactNode } from 'react';
import { CheckCircle2, CircleHelp, XCircle } from 'lucide-react';
import { cn } from '@apivator/ui';
import {
  certificateValidity,
  type CertExtensions,
  type Certificate,
  type CertificateRequest,
  type ChainReport,
  type DistinguishedName,
  type KeyInfo,
} from '@apivator/core/tools';
import { CopyButton } from '../../../components/ui/CopyButton';
import { formatDateTime, translate, useT } from '../../../i18n';

/** Sertifika aracının salt görüntüleme parçaları. */

export function Card({
  title,
  badges,
  children,
}: {
  title: string;
  badges?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2 rounded-md border border-line p-3">
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-fg">{title}</h3>
        {badges}
      </header>
      <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-3 gap-y-1 text-xs">{children}</dl>
    </section>
  );
}

export function Badge({ tone, children }: { tone: 'ok' | 'warn' | 'danger' | 'muted'; children: ReactNode }) {
  return (
    <span
      className={cn(
        'rounded px-1.5 py-0.5 text-[11px] font-medium',
        tone === 'ok' && 'bg-success/15 text-success',
        tone === 'warn' && 'bg-warning/15 text-warning',
        tone === 'danger' && 'bg-danger/15 text-danger',
        tone === 'muted' && 'bg-muted text-fg-muted',
      )}
    >
      {children}
    </span>
  );
}

export function Row({ label, children, copy }: { label: string; children: ReactNode; copy?: string }) {
  const t = useT('toolsSecurity');
  return (
    <>
      <dt className="text-fg-muted">{label}</dt>
      <dd className="flex min-w-0 items-start gap-1 text-fg">
        <div className="min-w-0 flex-1 break-all">{children}</div>
        {copy && <CopyButton text={copy} label={t('certificate.view.copyRow', { label })} compact />}
      </dd>
    </>
  );
}

function List({ items }: { items: string[] }) {
  return (
    <ul className="flex flex-col gap-0.5">
      {items.map((item, i) => (
        <li key={i} className="font-mono">
          {item}
        </li>
      ))}
    </ul>
  );
}

function DnRows({ label, dn }: { label: string; dn: DistinguishedName }) {
  const t = useT('toolsSecurity');
  return (
    <Row label={label} copy={dn.text}>
      {dn.attributes.length === 0 ? (
        <span className="text-fg-muted">{t('certificate.view.empty')}</span>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {dn.attributes.map((a, i) => (
            <li key={i}>
              <span className="text-fg-muted" title={a.oid}>
                {a.name}
              </span>{' '}
              = {a.value}
            </li>
          ))}
        </ul>
      )}
    </Row>
  );
}

function keyText(key: KeyInfo): string {
  const parts = [key.algorithm];
  if (key.curve) parts.push(key.curve);
  if (key.bits && !key.curve)
    parts.push(translate('toolsSecurity', 'certificate.view.bits', { bits: key.bits }));
  if (key.exponent) parts.push(`e=${key.exponent}`);
  return parts.join(' · ');
}

export function KeyText({ keyInfo }: { keyInfo: KeyInfo }) {
  return <>{keyText(keyInfo)}</>;
}

function formatInstant(date: Date): string {
  return `${formatDateTime(date, { dateStyle: 'long', timeStyle: 'medium' })} · ${date.toISOString()}`;
}

/** SAN, KU/EKU, temel kısıtlar, anahtar kimlikleri, CRL / AIA adresleri ve politikalar. */
function ExtensionRows({ ext }: { ext: CertExtensions }) {
  const t = useT('toolsSecurity');
  const bc = ext.basicConstraints;
  return (
    <>
      {ext.subjectAltNames.length > 0 && (
        <Row label="SAN" copy={ext.subjectAltNames.map((n) => `${n.type}:${n.value}`).join(', ')}>
          <List items={ext.subjectAltNames.map((n) => `${n.type}: ${n.value}`)} />
        </Row>
      )}
      {ext.keyUsage.length > 0 && <Row label={t('certificate.view.keyUsage')}>{ext.keyUsage.join(', ')}</Row>}
      {ext.extendedKeyUsage.length > 0 && (
        <Row label={t('certificate.view.extendedKeyUsage')}>
          <List
            items={ext.extendedKeyUsage.map((e) => (e.name === e.oid ? e.oid : `${e.name} (${e.oid})`))}
          />
        </Row>
      )}
      {bc && (
        <Row label={t('certificate.view.basicConstraints')}>
          {bc.ca ? t('certificate.view.caYes') : t('certificate.view.caNo')}
          {bc.pathLength !== undefined && ` · pathLen ${bc.pathLength}`}
          {bc.critical && t('certificate.view.critical')}
        </Row>
      )}
      {ext.subjectKeyId && (
        <Row label="SKI" copy={ext.subjectKeyId}>
          <span className="font-mono">{ext.subjectKeyId}</span>
        </Row>
      )}
      {ext.authorityKeyId && (
        <Row label="AKI" copy={ext.authorityKeyId}>
          <span className="font-mono">{ext.authorityKeyId}</span>
        </Row>
      )}
      {ext.crlDistributionPoints.length > 0 && (
        <Row label={t('certificate.view.crl')}>
          <List items={ext.crlDistributionPoints} />
        </Row>
      )}
      {ext.authorityInfoAccess.length > 0 && (
        <Row label="AIA">
          <List items={ext.authorityInfoAccess.map((a) => `${a.method}: ${a.location}`)} />
        </Row>
      )}
      {ext.policies.length > 0 && (
        <Row label={t('certificate.view.policies')}>
          <List items={ext.policies.map((p) => (p.name ? `${p.oid} — ${p.name}` : p.oid))} />
        </Row>
      )}
      {ext.all.length > 0 && (
        <Row label={t('certificate.view.extensions')}>
          <List
            items={ext.all.map(
              (e) =>
                `${e.name}${e.name === e.oid ? '' : ` (${e.oid})`}${e.critical ? t('certificate.view.critical') : ''}`,
            )}
          />
        </Row>
      )}
    </>
  );
}

export function CertificateCard({
  title,
  cert,
  fingerprints,
  now,
}: {
  title: string;
  cert: Certificate;
  fingerprints: { sha1: string; sha256: string } | null;
  now: Date;
}) {
  const t = useT('toolsSecurity');
  const validity = certificateValidity(cert, now);
  const tone = validity.status === 'valid' ? (validity.days < 30 ? 'warn' : 'ok') : 'danger';
  const statusLabel = t(
    validity.status === 'valid'
      ? 'certificate.view.status.valid'
      : validity.status === 'expired'
        ? 'certificate.view.status.expired'
        : 'certificate.view.status.notYet',
  );
  const daysText = t(
    validity.status === 'valid'
      ? 'certificate.view.daysLeft'
      : validity.status === 'expired'
        ? 'certificate.view.daysAgo'
        : 'certificate.view.startsIn',
    { days: validity.days },
  );
  const commonName = cert.subject.attributes.find((a) => a.name === 'CN')?.value;
  return (
    <Card
      title={commonName ? `${title}: ${commonName}` : title}
      badges={
        <>
          <Badge tone={tone}>
            {statusLabel} · {daysText}
          </Badge>
          {cert.selfSigned && <Badge tone="muted">{t('certificate.view.selfSigned')}</Badge>}
          {cert.extensions.basicConstraints?.ca && <Badge tone="muted">CA</Badge>}
        </>
      }
    >
      <DnRows label={t('certificate.view.subject')} dn={cert.subject} />
      <DnRows label={t('certificate.view.issuer')} dn={cert.issuer} />
      <Row label={t('certificate.view.serial')} copy={cert.serial}>
        <span className="font-mono">{cert.serial}</span>
      </Row>
      <Row label={t('certificate.view.version')}>v{cert.version}</Row>
      <Row label={t('certificate.view.notBefore')}>{formatInstant(cert.notBefore)}</Row>
      <Row label={t('certificate.view.notAfter')}>{formatInstant(cert.notAfter)}</Row>
      <Row label={t('certificate.view.publicKey')}>
        <KeyText keyInfo={cert.publicKey} />
      </Row>
      <Row label={t('certificate.view.signatureAlgorithm')}>{cert.signatureAlgorithm.name}</Row>
      <ExtensionRows ext={cert.extensions} />
      {fingerprints ? (
        <>
          <Row label={t('certificate.view.fingerprintSha256')} copy={fingerprints.sha256}>
            <span className="font-mono">{fingerprints.sha256}</span>
          </Row>
          <Row label={t('certificate.view.fingerprintSha1')} copy={fingerprints.sha1}>
            <span className="font-mono">{fingerprints.sha1}</span>
          </Row>
        </>
      ) : (
        <Row label={t('certificate.view.fingerprint')}>
          <span className="text-fg-muted">{t('certificate.view.needWebCrypto')}</span>
        </Row>
      )}
    </Card>
  );
}

export function CsrCard({ title, csr }: { title: string; csr: CertificateRequest }) {
  const t = useT('toolsSecurity');
  return (
    <Card title={title} badges={<Badge tone="muted">CSR</Badge>}>
      <DnRows label={t('certificate.view.subject')} dn={csr.subject} />
      <Row label={t('certificate.view.publicKey')}>
        <KeyText keyInfo={csr.publicKey} />
      </Row>
      <Row label={t('certificate.view.signatureAlgorithm')}>{csr.signatureAlgorithm.name}</Row>
      <ExtensionRows ext={csr.extensions} />
    </Card>
  );
}

function LinkIcon({ value }: { value: boolean | null | undefined }) {
  const t = useT('toolsSecurity');
  if (value === true)
    return <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-label={t('certificate.view.yes')} />;
  if (value === false)
    return <XCircle className="h-3.5 w-3.5 text-danger" aria-label={t('certificate.view.no')} />;
  return <CircleHelp className="h-3.5 w-3.5 text-fg-muted" aria-label={t('certificate.view.unknown')} />;
}

/** Yapraktan köke sıra ve her halkanın ad / anahtar kimliği / imza denetimi. */
export function ChainView({ report, names }: { report: ChainReport; names: string[] }) {
  const t = useT('toolsSecurity');
  return (
    <section
      className="flex flex-col gap-2 rounded-md border border-line p-3"
      aria-label={t('certificate.view.chain')}
    >
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-fg">{t('certificate.view.chain')}</h3>
        <Badge tone={report.endsAtRoot ? 'ok' : 'warn'}>
          {report.endsAtRoot ? t('certificate.view.reachesRoot') : t('certificate.view.noRoot')}
        </Badge>
        {!report.inOrder && <Badge tone="warn">{t('certificate.view.outOfOrder')}</Badge>}
      </header>
      <ol className="flex flex-col gap-1 text-xs">
        {report.links.map((link, pos) => (
          <li key={link.index} className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-medium text-fg">
              {pos + 1}. {names[link.index]}
            </span>
            <span className="flex items-center gap-1 text-fg-muted">
              <LinkIcon value={link.nameMatch} /> {t('certificate.view.nameLink')}
            </span>
            <span className="flex items-center gap-1 text-fg-muted">
              <LinkIcon value={link.keyIdMatch} /> AKI/SKI
            </span>
            <span className="flex items-center gap-1 text-fg-muted">
              <LinkIcon value={link.signatureValid} /> {t('certificate.view.signature')}
            </span>
          </li>
        ))}
      </ol>
      <p className="text-[11px] text-fg-subtle">{t('certificate.view.chainNote')}</p>
    </section>
  );
}
