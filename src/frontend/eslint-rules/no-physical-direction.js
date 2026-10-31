// Fiziksel yönlü Tailwind sınıflarını mantıksal karşılıklarına çevirir (sağdan sola diller için hazırlık).

// Fiziksel -> [mantıksal taban, değer ölçeği alır mı]. Ölçek alanlarda (ml-4, left-0) değer zorunludur;
// böylece "right-click" gibi sıradan sözcükler eşleşmez.
const BASES = {
  ml: ['ms', true],
  mr: ['me', true],
  pl: ['ps', true],
  pr: ['pe', true],
  left: ['start', true],
  right: ['end', true],
  'scroll-ml': ['scroll-ms', true],
  'scroll-mr': ['scroll-me', true],
  'scroll-pl': ['scroll-ps', true],
  'scroll-pr': ['scroll-pe', true],
  'text-left': ['text-start', false],
  'text-right': ['text-end', false],
  'border-l': ['border-s', false],
  'border-r': ['border-e', false],
  'rounded-l': ['rounded-s', false],
  'rounded-r': ['rounded-e', false],
  'rounded-tl': ['rounded-ss', false],
  'rounded-tr': ['rounded-se', false],
  'rounded-bl': ['rounded-es', false],
  'rounded-br': ['rounded-ee', false],
  'float-left': ['float-start', false],
  'float-right': ['float-end', false],
  'clear-left': ['clear-start', false],
  'clear-right': ['clear-end', false],
};

const BASE_NAMES = Object.keys(BASES)
  .sort((a, b) => b.length - a.length)
  .join('|');
// [varyant:]* [!] [-] taban [-değer]
const TOKEN = new RegExp(
  `^(?<pre>(?:[^\\s:]+:)*)(?<bang>!?)(?<neg>-?)(?<base>${BASE_NAMES})(?<rest>|-\\S*)$`,
);
const SCALE_VALUE = /^-(?:\d|\[|auto$|px$|full$|screen$)/;
// Sınıf adayı: tırnak, boşluk ve şablon ayraçları dışındaki ardışık karakterler.
const CANDIDATE = /[^\s"'`${}]+/g;
// left-1/2 gibi kesirli konum: translate ile ortalama için kullanılır.
const FRACTION = /(?:^|:)!?-?(?:left|right)-\d+\/\d+$/;

function convertToken(token) {
  const m = TOKEN.exec(token);
  if (!m) return null;
  const { pre, bang, neg, base, rest } = m.groups;
  const [logical, scaled] = BASES[base];
  if (scaled && !SCALE_VALUE.test(rest)) return null;
  return `${pre}${bang}${neg}${logical}${rest}`;
}

export default {
  meta: {
    type: 'problem',
    fixable: 'code',
    docs: {
      description: 'Fiziksel yönlü sınıf yerine mantıksal sınıf kullan (ms-, pe-, start-, text-end ...)',
    },
    schema: [],
    messages: {
      physical: '`{{from}}` fiziksel yönlüdür; mantıksal karşılığı `{{to}}`.',
      translated:
        '`{{from}}` translate ile birlikte kullanılıyor; translate sağdan sola dillerde yansımaz, elle çöz (ör. `rtl:` değişkeni).',
    },
  },
  create(context) {
    const { sourceCode } = context;

    function check(node) {
      const value = node.type === 'Literal' ? node.value : node.value.cooked;
      if (typeof value !== 'string') return;
      const raw = sourceCode.getText(node);
      const centered = value.includes('translate-x');
      for (const match of raw.matchAll(CANDIDATE)) {
        const token = match[0];
        const converted = convertToken(token);
        if (converted === null) continue;
        if (centered && FRACTION.test(token)) {
          context.report({ node, messageId: 'translated', data: { from: token } });
          continue;
        }
        const start = node.range[0] + match.index;
        context.report({
          node,
          messageId: 'physical',
          data: { from: token, to: converted },
          fix: (fixer) => fixer.replaceTextRange([start, start + token.length], converted),
        });
      }
    }

    return {
      Literal(node) {
        if (typeof node.value === 'string') check(node);
      },
      TemplateElement: check,
    };
  },
};
