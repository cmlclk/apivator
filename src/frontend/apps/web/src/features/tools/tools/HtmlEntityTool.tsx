import { htmlDecode, htmlEncode } from '@apivator/core/tools';
import { useT } from '../../../i18n';
import { CodecCheckbox, CodecTool } from '../CodecTool';
import { useToolInput } from '../toolsStore';

const ID = 'html-entity';

export default function HtmlEntityTool() {
  const t = useT('tools');
  const [direction] = useToolInput(ID, 'direction', 'encode');
  const [nonAscii, setNonAscii] = useToolInput(ID, 'nonAscii', '');
  const [named, setNamed] = useToolInput(ID, 'named', '');

  return (
    <CodecTool
      toolId={ID}
      run={(input, decoding) =>
        decoding ? htmlDecode(input) : htmlEncode(input, { nonAscii: nonAscii === '1', named: named === '1' })
      }
      options={
        direction !== 'decode' && (
          <>
            <CodecCheckbox label={t('htmlEntity.nonAscii')} value={nonAscii} onChange={setNonAscii} />
            <CodecCheckbox
              label={t('htmlEntity.named')}
              value={named}
              onChange={setNamed}
              disabled={nonAscii !== '1'}
            />
          </>
        )
      }
      plainLabel={t('codec.text')}
      encodedLabel="HTML"
      plainPlaceholder={'<a href="?q=ç">Tom & Jerry</a>'}
      encodedPlaceholder={'&lt;b&gt;&ccedil;ay &amp; simit&lt;/b&gt;'}
      fileName="html"
    />
  );
}
