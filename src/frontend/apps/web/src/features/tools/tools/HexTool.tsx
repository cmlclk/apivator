import { bytesToHex, hexToBytes, utf8Decode, utf8Encode, type HexSeparator } from '@apivator/core/tools';
import { useT } from '../../../i18n';
import { CodecCheckbox, CodecSelect, CodecTool } from '../CodecTool';
import { useToolInput } from '../toolsStore';

const ID = 'hex';

export default function HexTool() {
  const t = useT('tools');
  const [direction] = useToolInput(ID, 'direction', 'encode');
  const [separator, setSeparator] = useToolInput(ID, 'separator', 'space');
  const [upper, setUpper] = useToolInput(ID, 'upper', '');
  const [invalid, setInvalid] = useToolInput(ID, 'invalid', 'error');

  return (
    <CodecTool
      toolId={ID}
      run={(input, decoding) =>
        decoding
          ? utf8Decode(hexToBytes(input), invalid === 'error')
          : bytesToHex(utf8Encode(input), { separator: separator as HexSeparator, upper: upper === '1' })
      }
      options={
        direction === 'decode' ? (
          <CodecSelect
            label={t('hex.invalidUtf8')}
            value={invalid}
            onChange={setInvalid}
            choices={[
              ['error', t('hex.showError')],
              ['replace', t('hex.replace')],
            ]}
          />
        ) : (
          <>
            <CodecSelect
              label={t('hex.separator')}
              value={separator}
              onChange={setSeparator}
              choices={[
                ['none', t('hex.sepNone')],
                ['space', t('hex.sepSpace')],
                ['colon', t('hex.sepColon')],
                ['0x', '0x (0x48 0x65)'],
                ['\\x', '\\x (\\x48\\x65)'],
              ]}
            />
            <CodecCheckbox label={t('hex.uppercase')} value={upper} onChange={setUpper} />
          </>
        )
      }
      encodeAction={t('hex.encode')}
      decodeAction={t('hex.decode')}
      plainLabel={t('codec.text')}
      encodedLabel="Hex"
      plainPlaceholder="Merhaba"
      encodedPlaceholder="4d 65 72 68 61 62 61 veya 0x4d, 0x65 veya \x4d\x65"
      fileName="hex"
    />
  );
}
