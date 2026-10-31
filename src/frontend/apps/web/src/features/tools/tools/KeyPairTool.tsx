import { useEffect, useState } from 'react';
import { KeyRound } from 'lucide-react';
import { Alert, Button } from '@apivator/ui';
import {
  EC_CURVES,
  KEY_HASHES,
  RSA_MODULUS_LENGTHS,
  generateKeyPair,
  hasWebCrypto,
  supportsEd25519,
  type EcCurve,
  type GeneratedKeyPair,
  type KeyHash,
  type KeyPairAlgorithm,
  type RsaModulusLength,
} from '@apivator/core/tools';
import { CopyButton } from '../../../components/ui/CopyButton';
import { useT } from '../../../i18n';
import { ToolErrorMessage, ToolOptions, ToolPane } from '../ToolLayout';
import { toolErrorText, toolLabelClass, toolSelectClass } from '../toolUtils';
import { useToolInput } from '../toolsStore';
import { OaepSection } from './OaepSection';

const ALGORITHM_LABEL_KEYS = {
  'RSA-OAEP': 'keyPair.algorithms.rsaOaep',
  'RSASSA-PKCS1-v1_5': 'keyPair.algorithms.rsaPkcs1',
  'RSA-PSS': 'keyPair.algorithms.rsaPss',
  ECDSA: 'keyPair.algorithms.ecdsa',
  Ed25519: 'keyPair.algorithms.ed25519',
} as const satisfies Record<KeyPairAlgorithm, string>;

interface Generated extends GeneratedKeyPair {
  /** Dosya adlarında kullanılan kısa ad (ör. rsa-2048). */
  slug: string;
  algorithm: KeyPairAlgorithm;
  hash: KeyHash;
}

export default function KeyPairTool() {
  const t = useT('toolsSecurity');
  const [algorithmValue, setAlgorithm] = useToolInput('key-pair', 'algorithm', 'RSA-OAEP');
  const [modulusValue, setModulus] = useToolInput('key-pair', 'modulusLength', '2048');
  const [hashValue, setHash] = useToolInput('key-pair', 'hash', 'SHA-256');
  const [curveValue, setCurve] = useToolInput('key-pair', 'curve', 'P-256');
  const [format, setFormat] = useToolInput('key-pair', 'format', 'pem');
  // Üretilen anahtarlar yalnızca bu bileşende tutulur; hiçbir yere kaydedilmez.
  const [pair, setPair] = useState<Generated | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ed25519, setEd25519] = useState<boolean | null>(null);

  const webCrypto = hasWebCrypto();
  const algorithm = algorithmValue as KeyPairAlgorithm;
  const isRsa = algorithm.startsWith('RSA');
  const modulusLength = Number(modulusValue) as RsaModulusLength;

  useEffect(() => {
    let cancelled = false;
    void supportsEd25519().then((ok) => !cancelled && setEd25519(ok));
    return () => {
      cancelled = true;
    };
  }, []);

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const hash = hashValue as KeyHash;
      const next = await generateKeyPair({
        algorithm,
        modulusLength,
        hash,
        namedCurve: curveValue as EcCurve,
      });
      const slug = isRsa
        ? `rsa-${modulusLength}`
        : algorithm === 'ECDSA'
          ? `ec-${curveValue.toLowerCase()}`
          : 'ed25519';
      setPair({ ...next, slug, algorithm, hash });
    } catch (err) {
      setPair(null);
      setError(toolErrorText(err));
    } finally {
      setBusy(false);
    }
  };

  const jwk = format === 'jwk';
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
      {!webCrypto && <Alert tone="warning">{t('keyPair.webCryptoWarning')}</Alert>}
      <p className="text-xs text-fg-muted">{t('keyPair.localOnly')}</p>
      <ToolOptions>
        <label className={toolLabelClass}>
          {t('keyPair.algorithm')}
          <select
            className={toolSelectClass}
            value={algorithm}
            onChange={(e) => setAlgorithm(e.target.value)}
          >
            {(Object.keys(ALGORITHM_LABEL_KEYS) as KeyPairAlgorithm[]).map((name) => (
              <option key={name} value={name} disabled={name === 'Ed25519' && ed25519 === false}>
                {t(ALGORITHM_LABEL_KEYS[name])}
                {name === 'Ed25519' && ed25519 === false ? t('keyPair.unsupported') : ''}
              </option>
            ))}
          </select>
        </label>
        {isRsa && (
          <>
            <label className={toolLabelClass}>
              {t('keyPair.size')}
              <select
                className={toolSelectClass}
                value={modulusValue}
                onChange={(e) => setModulus(e.target.value)}
              >
                {RSA_MODULUS_LENGTHS.map((bits) => (
                  <option key={bits} value={bits}>
                    {t('keyPair.bits', { bits })}
                  </option>
                ))}
              </select>
            </label>
            <label className={toolLabelClass}>
              {t('keyPair.hash')}
              <select className={toolSelectClass} value={hashValue} onChange={(e) => setHash(e.target.value)}>
                {KEY_HASHES.map((hash) => (
                  <option key={hash} value={hash}>
                    {hash}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        {algorithm === 'ECDSA' && (
          <label className={toolLabelClass}>
            {t('keyPair.curve')}
            <select className={toolSelectClass} value={curveValue} onChange={(e) => setCurve(e.target.value)}>
              {EC_CURVES.map((curve) => (
                <option key={curve} value={curve}>
                  {curve}
                </option>
              ))}
            </select>
          </label>
        )}
        <Button size="sm" onClick={() => void generate()} loading={busy} disabled={!webCrypto || busy}>
          <KeyRound className="h-3.5 w-3.5" /> {t('keyPair.generate')}
        </Button>
        {busy && isRsa && modulusLength >= 4096 && (
          <span className="text-xs text-fg-muted" role="status">
            {t('keyPair.slow')}
          </span>
        )}
      </ToolOptions>
      <ToolErrorMessage error={error} />
      {pair && (
        <>
          <dl className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1 rounded-md border border-line p-3 text-xs">
            <dt className="col-span-3 font-semibold text-fg-muted">{t('keyPair.fingerprint')}</dt>
            {(
              [
                ['Hex', pair.fingerprint.hex],
                ['Base64', pair.fingerprint.base64],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-fg-muted">{label}</dt>
                <dd className="min-w-0 break-all font-mono text-fg">{value}</dd>
                <CopyButton text={value} label={t('keyPair.copyFingerprint', { label })} compact />
              </div>
            ))}
          </dl>
          <ToolOptions>
            <label className={toolLabelClass}>
              {t('keyPair.format')}
              <select className={toolSelectClass} value={format} onChange={(e) => setFormat(e.target.value)}>
                <option value="pem">{t('keyPair.formatPem')}</option>
                <option value="jwk">JWK</option>
              </select>
            </label>
          </ToolOptions>
          <div className="flex flex-col gap-3 lg:flex-row">
            <ToolPane
              label={jwk ? t('keyPair.privateJwk') : t('keyPair.privatePem')}
              value={jwk ? pair.privateJwk : pair.privatePem}
              language={jwk ? 'Json' : 'Text'}
              downloadName={jwk ? `${pair.slug}-private.jwk.json` : `${pair.slug}-private.pem`}
              className="h-72 flex-none lg:flex-1"
            />
            <ToolPane
              label={jwk ? t('keyPair.publicJwk') : t('keyPair.publicPem')}
              value={jwk ? pair.publicJwk : pair.publicPem}
              language={jwk ? 'Json' : 'Text'}
              downloadName={jwk ? `${pair.slug}-public.jwk.json` : `${pair.slug}-public.pem`}
              output
              className="h-72 flex-none lg:flex-1"
            />
          </div>
        </>
      )}
      <OaepSection
        generated={
          pair?.algorithm === 'RSA-OAEP'
            ? { publicPem: pair.publicPem, privatePem: pair.privatePem, hash: pair.hash }
            : null
        }
      />
    </div>
  );
}
