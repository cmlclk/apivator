import type { ReactNode } from 'react';
import { useT } from '../../i18n';
import { SwapButton, ToolErrorMessage, ToolOptions, ToolPane, TwoPanes } from './ToolLayout';
import { toolErrorText, toolLabelClass, toolSelectClass } from './toolUtils';
import { useToolInput } from './toolsStore';

/**
 * Metinden metne kodlama araçlarının ortak iskeleti: yön seçimi, araç-özel seçenekler, yer değiştirme,
 * girdi ve çıktı alanları. Girdi ve yön `useToolInput` ile hatırlanır (`direction`: encode | decode);
 * seçenekleri yöne göre değişen araçlar aynı alanı kendileri de okuyabilir.
 */
export function CodecTool({
  toolId,
  run,
  options,
  plainLabel,
  encodedLabel,
  plainPlaceholder,
  encodedPlaceholder,
  encodeAction,
  decodeAction,
  fileName,
}: {
  toolId: string;
  /** Dönüşüm; işlenemeyen girdide ToolError fırlatır. */
  run: (input: string, decoding: boolean) => string;
  /** Yön seçiminin yanında gösterilecek seçenekler. */
  options?: ReactNode;
  /** Kodlanmamış taraf (kodlamada girdi, çözmede çıktı) ve kodlanmış tarafın başlıkları. */
  plainLabel: string;
  encodedLabel: string;
  plainPlaceholder?: string;
  encodedPlaceholder?: string;
  encodeAction?: string;
  decodeAction?: string;
  /** İndirilen dosyanın adı (uzantısız). */
  fileName: string;
}) {
  const t = useT('tools');
  const [input, setInput] = useToolInput(toolId, 'input');
  const [direction, setDirection] = useToolInput(toolId, 'direction', 'encode');
  const decoding = direction === 'decode';

  let output = '';
  let error: string | null = null;
  if (input) {
    try {
      output = run(input, decoding);
    } catch (caught) {
      error = toolErrorText(caught);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <ToolOptions>
        <label className={toolLabelClass}>
          {t('codec.operation')}
          <select
            className={toolSelectClass}
            value={direction}
            onChange={(e) => setDirection(e.target.value)}
          >
            <option value="encode">{encodeAction ?? t('codec.encode')}</option>
            <option value="decode">{decodeAction ?? t('codec.decode')}</option>
          </select>
        </label>
        {options}
        <SwapButton
          onClick={() => {
            if (error) return;
            setInput(output);
            setDirection(decoding ? 'encode' : 'decode');
          }}
        />
      </ToolOptions>
      <ToolErrorMessage error={error} />
      <TwoPanes>
        <ToolPane
          label={decoding ? encodedLabel : plainLabel}
          value={input}
          onChange={setInput}
          placeholder={decoding ? encodedPlaceholder : plainPlaceholder}
          fileAccept=""
        />
        <ToolPane
          label={decoding ? plainLabel : encodedLabel}
          value={output}
          output
          downloadName={`${fileName}-${decoding ? 'cozulmus' : 'kodlanmis'}.txt`}
        />
      </TwoPanes>
    </div>
  );
}

/** Seçenek satırı için onay kutusu; değer `'1'` ya da `''` olarak saklanır. */
export function CodecCheckbox({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className={toolLabelClass}>
      <input
        type="checkbox"
        checked={value === '1'}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked ? '1' : '')}
      />
      {label}
    </label>
  );
}

/** Seçenek satırı için açılır liste. */
export function CodecSelect({
  label,
  value,
  onChange,
  choices,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  choices: [value: string, label: string][];
}) {
  return (
    <label className={toolLabelClass}>
      {label}
      <select className={toolSelectClass} value={value} onChange={(e) => onChange(e.target.value)}>
        {choices.map(([key, text]) => (
          <option key={key} value={key}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}
