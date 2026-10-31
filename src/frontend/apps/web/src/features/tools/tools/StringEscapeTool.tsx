import { escapeString, unescapeString, type EscapeLanguage } from '@apivator/core/tools';
import { useT } from '../../../i18n';
import { CodecCheckbox, CodecSelect, CodecTool } from '../CodecTool';
import { useToolInput } from '../toolsStore';

const ID = 'string-escape';

export default function StringEscapeTool() {
  const t = useT('tools');
  const languages: [EscapeLanguage, string][] = [
    ['json', 'JSON'],
    ['javascript', 'JavaScript'],
    ['java', 'Java'],
    ['csharp', 'C# ("...")'],
    ['csharp-verbatim', 'C# verbatim (@"...")'],
    ['sql', "SQL ('...')"],
    ['regex', t('stringEscape.regexPattern')],
  ];
  const [language, setLanguage] = useToolInput(ID, 'language', 'json');
  const [quote, setQuote] = useToolInput(ID, 'quote', '');
  const lang = language as EscapeLanguage;
  const options = { quote: quote === '1' };

  return (
    <CodecTool
      toolId={ID}
      run={(input, decoding) =>
        decoding ? unescapeString(input, lang, options) : escapeString(input, lang, options)
      }
      options={
        <>
          <CodecSelect
            label={t('stringEscape.language')}
            value={language}
            onChange={setLanguage}
            choices={languages}
          />
          {lang !== 'regex' && (
            <CodecCheckbox label={t('stringEscape.quotes')} value={quote} onChange={setQuote} />
          )}
        </>
      }
      encodeAction={t('stringEscape.encode')}
      decodeAction={t('stringEscape.decode')}
      plainLabel={t('codec.text')}
      encodedLabel={t('codec.escapedText')}
      plainPlaceholder={'Dosya: "C:\\temp"\nO\'Brien'}
      encodedPlaceholder={'Dosya: \\"C:\\\\temp\\"\\nO\'Brien'}
      fileName="kacis"
    />
  );
}
