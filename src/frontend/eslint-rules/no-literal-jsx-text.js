// JSX içinde çevrilmemiş (gömülü) arayüz metnini yakalar; metin dil dosyasına taşınıp `t(...)` ile kullanılmalı.

// Çevrilmeyen marka ve teknik belirteçler (tek yerde). Büyük/küçük harf duyarlı.
// Büyük harfli kısaltmalar (HEX, SAN, KB/MB), rakamlı belirteçler (S256, Draft-07), çok kamburlu adlar (HttpOnly,
// SameSite), tek harfler ve kod görünümlü belirteçler ayrıca `isCodeLike` ile serbesttir.
const ALLOWED_WORDS = new Set([
  // marka
  'Apivator',
  'Slack',
  'Teams',
  'Excel',
  'Python',
  'Lombok',
  'Postman',
  // protokol ve biçim adları
  'HTTP',
  'HTTPS',
  'URL',
  'URI',
  'JSON',
  'XML',
  'HTML',
  'YAML',
  'CSV',
  'REST',
  'SOAP',
  'GraphQL',
  'gRPC',
  'WebSocket',
  'SSE',
  'Base64',
  'cURL',
  'OpenAPI',
  'OAuth',
  'TLS',
  'SSL',
  'DNS',
  'API',
  'SQL',
  'Hex',
  'IPv',
  // HTTP yöntemleri
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
  // protokol alan ve öznitelik adları (her dilde aynı yazılır)
  'Header',
  'Payload',
  'Token',
  'Host',
  'Port',
  'Domain',
  'Path',
  'Proxy',
  'Hash',
  'Secure',
  'Priority',
  'Partitioned',
  'Strict',
  'Lax',
  'None',
  'Low',
  'Medium',
  'High',
  'Bearer',
  // kod anahtar sözcükleri ve değerleri
  'null',
  'plain',
  'nanoid',
  'implements',
  'Draft',
  'alg',
  'typ',
  // klavye tuşları ve birimler
  'Ctrl',
  'Shift',
  'Alt',
  'Enter',
  'Esc',
  'Tab',
  'ms',
  'KB',
  'MB',
  'GB',
  'TB',
  'Bit',
]);

// Kullanıcıya görünen öznitelikler: değerleri düz dizeyse çevrilmelidir.
const VISIBLE_ATTRIBUTES = new Set([
  'title',
  'placeholder',
  'aria-label',
  'alt',
  'label',
  'aria-description',
  'aria-placeholder',
]);

const LETTER = /\p{L}/u;

// Baştaki ve sondaki noktalama/simgeyi atar ("Content-Type:" -> "Content-Type").
function stripEdges(token) {
  return token.replace(/^[^\p{L}\p{N}{(\[/]+/u, '').replace(/[^\p{L}\p{N})\]}]+$/u, '');
}

// Tek belirteç kod görünümlü mü: {{var}}, Content-Type, pm.test(...), api.example.com, /yol, camelCase, snake_case.
function isCodeLike(token) {
  if (/[{}()[\]_=<>@$\\]/.test(token)) return true;
  if (/^\/\S/.test(token) || token.includes('://')) return true;
  if (/^[A-Za-z]$/.test(token)) return true;
  if (/^[A-Z0-9]{2,}(?:[-/][A-Z0-9]+)*$/.test(token)) return true;
  if (/\d/.test(token) && /^[\x21-\x7e]+$/.test(token)) return true;
  if (/^[A-Z][A-Za-z0-9]*(-[A-Z][A-Za-z0-9]*)+$/.test(token)) return true;
  if (/^[A-Za-z0-9]+(?:[.:][A-Za-z0-9]+)+$/.test(token)) return true;
  if (/^[a-z][a-z0-9]*[A-Z][A-Za-z0-9]*$/.test(token)) return true;
  if (/^[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)+$/.test(token)) return true;
  return false;
}

// `sample`: örnek değer gösteren alan (placeholder); `{...}`/`[...]` yükleri, parantezli kod, URL ve çok satırlı örnekler çevrilmez.
export function isAllowedText(text, sample = false) {
  if (!LETTER.test(text)) return true;
  if (sample && /^\s*[[{]|\w\(|\{|:\/\/|\n/.test(text)) return true;
  return text
    .split(/\s+/)
    .filter(Boolean)
    .every((raw) => {
      if (isCodeLike(raw)) return true;
      const token = stripEdges(raw);
      return !LETTER.test(token) || ALLOWED_WORDS.has(token) || isCodeLike(token);
    });
}

function stringValue(node) {
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'TemplateLiteral') return node.quasis.map((q) => q.value.cooked ?? '').join(' ');
  return null;
}

export default {
  meta: {
    type: 'problem',
    docs: { description: 'JSX içinde çevrilmemiş arayüz metni bırakma' },
    schema: [],
    messages: {
      text: 'Gömülü metin: "{{text}}" dil dosyasına taşınıp t(...) ile kullanılmalı.',
      attribute:
        '`{{name}}` özniteliğinde gömülü metin: "{{text}}" dil dosyasına taşınıp t(...) ile kullanılmalı.',
    },
  },
  create(context) {
    const report = (node, messageId, text, name) =>
      context.report({
        node,
        messageId,
        data: { text: text.trim().replace(/\s+/g, ' ').slice(0, 40), name },
      });

    return {
      JSXText(node) {
        if (!isAllowedText(node.value)) report(node, 'text', node.value);
      },
      JSXExpressionContainer(node) {
        // {'Merhaba'} gibi çocuk ifadeleri; öznitelik değerleri JSXAttribute ziyaretinde işlenir.
        if (node.parent.type === 'JSXAttribute') return;
        const text = stringValue(node.expression);
        if (text !== null && !isAllowedText(text)) report(node, 'text', text);
      },
      JSXAttribute(node) {
        if (node.name.type !== 'JSXIdentifier' || !VISIBLE_ATTRIBUTES.has(node.name.name) || !node.value)
          return;
        const value = node.value.type === 'JSXExpressionContainer' ? node.value.expression : node.value;
        const text = stringValue(value);
        if (text !== null && !isAllowedText(text, node.name.name === 'placeholder'))
          report(node, 'attribute', text, node.name.name);
      },
    };
  },
};
