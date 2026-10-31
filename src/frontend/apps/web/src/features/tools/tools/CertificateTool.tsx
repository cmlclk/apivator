import { useEffect, useState } from 'react';
import { Alert, Spinner } from '@apivator/ui';
import { analyzeChain, base64Encode, inspectPem, type ChainReport, type PemItem } from '@apivator/core/tools';
import { translate, useT } from '../../../i18n';
import { ToolErrorMessage, ToolPane, TwoPanes } from '../ToolLayout';
import { toolErrorText } from '../toolUtils';
import { useToolInput } from '../toolsStore';
import { Badge, Card, CertificateCard, ChainView, CsrCard, KeyText, Row } from './certificateView';

/** Yazarken her tuşta yeniden ayrıştırılmasın. */
const DEBOUNCE_MS = 200;
/** İkili sertifika dosyası Base64'e çevrilip metin alanına yazılır. */
const MAX_FILE = 5 * 1024 * 1024;

interface Result {
  items: PemItem[];
  chain: ChainReport | null;
  /** Zincirdeki adlar (`certs` sırasıyla). */
  names: string[];
  /** Zincire giren sertifikaların `items` içindeki konumu. */
  certItems: number[];
}

async function inspect(input: string): Promise<Result> {
  const items = await inspectPem(input);
  const certItems = items.flatMap((item, i) => (item.kind === 'certificate' ? [i] : []));
  const certs = certItems.map((i) => (items[i] as Extract<PemItem, { kind: 'certificate' }>).certificate);
  const names = certs.map(
    (c) =>
      c.subject.attributes.find((a) => a.name === 'CN')?.value ??
      (c.subject.text || translate('toolsSecurity', 'certificate.unnamed')),
  );
  return { items, chain: certs.length > 1 ? await analyzeChain(certs) : null, names, certItems };
}

export default function CertificateTool() {
  const t = useT('toolsSecurity');
  // Araç girdisi diske yazılmaz (özel anahtar yapıştırılabilir): toolsStore UNSAVED_TOOLS.
  const [input, setInput] = useToolInput('certificate', 'input');
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!input.trim()) {
      setResult(null);
      setError(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      setBusy(true);
      inspect(input)
        .then((next) => {
          if (cancelled) return;
          setResult(next);
          setError(null);
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          setResult(null);
          setError(toolErrorText(e));
        })
        .finally(() => {
          if (!cancelled) setBusy(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [input]);

  const loadFile = (file: File) => {
    if (file.size > MAX_FILE) {
      setError(t('certificate.fileTooBig'));
      return;
    }
    void file.arrayBuffer().then((buffer) => {
      const bytes = new Uint8Array(buffer);
      // DER (ikili) dosya Base64 olarak, PEM metin olarak yazılır.
      setInput(bytes[0] === 0x30 ? base64Encode(bytes, { lineLength: 64 }) : new TextDecoder().decode(bytes));
    });
  };

  const now = new Date();
  const hasPrivate = result?.items.some((i) => i.kind === 'private-key');
  const certCount = result?.certItems.length ?? 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <TwoPanes>
        <ToolPane
          label="PEM / DER"
          value={input}
          onChange={setInput}
          fileAccept=".pem,.crt,.cer,.der,.csr,.key,.pub,.p8"
          onLoadFile={loadFile}
          placeholder={t('certificate.placeholder')}
        />
        <section
          className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-auto"
          aria-label={t('certificate.resultLabel')}
          aria-busy={busy}
        >
          {busy && <Spinner className="h-3.5 w-3.5" />}
          <ToolErrorMessage error={error} />
          {hasPrivate && <Alert tone="warning">{t('certificate.privateKeyWarning')}</Alert>}
          {!result && !error && (
            <p className="rounded-md border border-line p-3 text-sm text-fg-muted">
              {t('certificate.empty')}
            </p>
          )}
          {result?.chain && <ChainView report={result.chain} names={result.names} />}
          {result?.items.map((item) => {
            const title =
              certCount > 1 && item.kind === 'certificate'
                ? t('certificate.titleNumbered', { n: result.certItems.indexOf(item.index) + 1 })
                : t('certificate.title');
            return <ItemView key={item.index} item={item} title={title} now={now} />;
          })}
        </section>
      </TwoPanes>
    </div>
  );
}

function ItemView({ item, title, now }: { item: PemItem; title: string; now: Date }) {
  const t = useT('toolsSecurity');
  switch (item.kind) {
    case 'certificate':
      return (
        <CertificateCard title={title} cert={item.certificate} fingerprints={item.fingerprints} now={now} />
      );
    case 'csr':
      return <CsrCard title={t('certificate.csrTitle')} csr={item.csr} />;
    case 'public-key':
      return (
        <Card title={t('certificate.publicKey')} badges={<Badge tone="muted">{item.label}</Badge>}>
          <Row label={t('certificate.key')}>
            <KeyText keyInfo={item.key} />
          </Row>
          <Row label={t('certificate.algorithmOid')}>{item.key.oid}</Row>
        </Card>
      );
    case 'private-key':
      return (
        <Card
          title={t('certificate.privateKey')}
          badges={<Badge tone="danger">{t('certificate.secret', { label: item.label })}</Badge>}
        >
          <Row label={t('certificate.key')}>
            {item.encrypted ? (
              t('certificate.encryptedKey')
            ) : item.key ? (
              <KeyText keyInfo={item.key} />
            ) : (
              t('certificate.unknownKind')
            )}
          </Row>
        </Card>
      );
    case 'unknown':
      return (
        <Card title={item.label} badges={<Badge tone="muted">{t('certificate.unsupportedPem')}</Badge>}>
          <Row label={t('certificate.note')}>{t('certificate.unsupportedBlock')}</Row>
        </Card>
      );
    case 'error':
      return (
        <Alert tone="error">
          {t('certificate.blockError', { label: item.label, n: item.index + 1, error: item.error })}
        </Alert>
      );
  }
}
