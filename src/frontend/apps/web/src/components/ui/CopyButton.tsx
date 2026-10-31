import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '@apivator/ui';
import { useT } from '../../i18n';

/** Metni panoya kopyalar; kısa süre "Kopyalandı" gösterir. */
export function CopyButton({
  text,
  label,
  compact = false,
}: {
  text: string;
  label: string;
  compact?: boolean;
}) {
  const t = useT('common');
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size={compact ? 'icon' : 'sm'}
      variant={compact ? 'ghost' : 'secondary'}
      aria-label={label}
      title={label}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {!compact && (copied ? t('actions.copied') : t('actions.copy'))}
    </Button>
  );
}
