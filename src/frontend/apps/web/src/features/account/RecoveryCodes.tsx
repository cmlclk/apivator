import { Download } from 'lucide-react';
import { Button } from '@apivator/ui';
import { useT } from '../../i18n';
import { CopyButton } from '../../components/ui/CopyButton';
import { saveFile } from '../../lib/download';

/** Yedek kodlar: yalnızca bir kez gösterilir; kopyalanır ya da dosya olarak indirilir. */
export function RecoveryCodes({ codes, email }: { codes: string[]; email?: string }) {
  const t = useT('account');
  const text = [
    email ? t('recovery.headerEmail', { email }) : t('recovery.header'),
    t('recovery.note'),
    '',
    ...codes,
    '',
  ].join('\n');
  return (
    <div className="flex flex-col gap-2">
      <ol
        aria-label={t('recovery.list')}
        className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-md border border-line bg-muted/40 px-4 py-3 font-mono text-[13px]"
      >
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ol>
      <div className="flex justify-end gap-2">
        <CopyButton text={codes.join('\n')} label={t('recovery.copy')} />
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            void saveFile({
              blob: new Blob([text], { type: 'text/plain;charset=utf-8' }),
              fileName: t('recovery.fileName'),
            })
          }
        >
          <Download className="h-3.5 w-3.5" /> {t('recovery.download')}
        </Button>
      </div>
    </div>
  );
}
