import {
  ToolError,
  base32Decode,
  base32Encode,
  bytesToHex,
  utf8Decode,
  utf8Encode,
  type Base32Variant,
} from '@apivator/core/tools';
import { translate, useT } from '../../../i18n';
import { CodecCheckbox, CodecSelect, CodecTool } from '../CodecTool';
import { useToolInput } from '../toolsStore';

const ID = 'base32';

/** Çözülen veri metin değilse (ör. TOTP gizli anahtarı) hex gösterimi önerilir. */
function decodedText(bytes: Uint8Array, asHex: boolean): string {
  if (asHex) return bytesToHex(bytes, { separator: 'space' });
  try {
    return utf8Decode(bytes, true);
  } catch {
    throw new ToolError(translate('tools', 'base32.notUtf8'));
  }
}

export default function Base32Tool() {
  const t = useT('tools');
  const [direction] = useToolInput(ID, 'direction', 'encode');
  const [variant, setVariant] = useToolInput(ID, 'variant', 'standard');
  const [padding, setPadding] = useToolInput(ID, 'padding', '1');
  const [output, setOutput] = useToolInput(ID, 'output', 'text');

  return (
    <CodecTool
      toolId={ID}
      run={(input, decoding) =>
        decoding
          ? decodedText(base32Decode(input, variant as Base32Variant), output === 'hex')
          : base32Encode(utf8Encode(input), { variant: variant as Base32Variant, padding: padding === '1' })
      }
      options={
        <>
          <CodecSelect
            label={t('base32.alphabet')}
            value={variant}
            onChange={setVariant}
            choices={[
              ['standard', t('base32.alphabetStandard')],
              ['hex', t('base32.alphabetHex')],
            ]}
          />
          {direction === 'decode' ? (
            <CodecSelect
              label={t('base32.output')}
              value={output}
              onChange={setOutput}
              choices={[
                ['text', t('base32.outputText')],
                ['hex', 'Hex'],
              ]}
            />
          ) : (
            <CodecCheckbox label={t('base32.padding')} value={padding} onChange={setPadding} />
          )}
        </>
      }
      plainLabel={t('codec.text')}
      encodedLabel="Base32"
      plainPlaceholder="Merhaba"
      encodedPlaceholder="JVSXE2DBMJQQ===="
      fileName="base32"
    />
  );
}
