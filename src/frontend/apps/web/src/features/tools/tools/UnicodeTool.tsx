import { unicodeEscape, unicodeUnescape, type UnicodeEscapeStyle } from '@apivator/core/tools';
import { useT } from '../../../i18n';
import { CodecCheckbox, CodecSelect, CodecTool } from '../CodecTool';
import { useToolInput } from '../toolsStore';

const ID = 'unicode';

export default function UnicodeTool() {
  const t = useT('tools');
  const [direction] = useToolInput(ID, 'direction', 'encode');
  const [style, setStyle] = useToolInput(ID, 'style', 'utf16');
  const [all, setAll] = useToolInput(ID, 'all', '');
  const [upper, setUpper] = useToolInput(ID, 'upper', '');
  const [strict, setStrict] = useToolInput(ID, 'strict', '');

  return (
    <CodecTool
      toolId={ID}
      run={(input, decoding) =>
        decoding
          ? unicodeUnescape(input, { strict: strict === '1' })
          : unicodeEscape(input, {
              style: style as UnicodeEscapeStyle,
              all: all === '1',
              upper: upper === '1',
            })
      }
      options={
        direction !== 'decode' ? (
          <>
            <CodecSelect
              label={t('unicode.style')}
              value={style}
              onChange={setStyle}
              choices={[
                ['utf16', '\\uXXXX (JSON, Java, C#, JS)'],
                ['codepoint', '\\u{XXXXX} (ES6, Rust, Swift)'],
                ['python', '\\uXXXX / \\UXXXXXXXX (Python, C)'],
              ]}
            />
            <CodecCheckbox label={t('unicode.allChars')} value={all} onChange={setAll} />
            <CodecCheckbox label={t('unicode.uppercase')} value={upper} onChange={setUpper} />
          </>
        ) : (
          <CodecCheckbox label={t('unicode.strict')} value={strict} onChange={setStrict} />
        )
      }
      encodeAction={t('unicode.encode')}
      decodeAction={t('unicode.decode')}
      plainLabel={t('codec.text')}
      encodedLabel={t('codec.escapedText')}
      plainPlaceholder="Çağrı 🚀"
      encodedPlaceholder="\u00c7a\u011fr\u0131, \u{1F680}, U+00E7"
      fileName="unicode"
    />
  );
}
