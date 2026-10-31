import { msg } from './i18n';
import { toCurl } from './curl';
import { applyAuth } from './http';
import type { KeyValueItem, RequestBody, RequestDefinition } from './types';

export type CodeLanguage = 'curl' | 'csharp' | 'javascript' | 'python' | 'go' | 'powershell';

export const CODE_LANGUAGES: { id: CodeLanguage; label: string }[] = [
  { id: 'curl', label: 'cURL' },
  { id: 'csharp', label: 'C# HttpClient' },
  { id: 'javascript', label: 'JavaScript fetch' },
  { id: 'python', label: 'Python requests' },
  { id: 'go', label: 'Go net/http' },
  { id: 'powershell', label: 'PowerShell' },
];

/** Değişkenleri çözülmüş, yetkilendirme mirası çözülmüş istek. */
export type CodeRequest = Pick<RequestDefinition, 'method' | 'url' | 'headers' | 'body' | 'auth'>;

const RAW_TYPES: Record<string, string> = {
  Json: 'application/json',
  Xml: 'application/xml',
  Html: 'text/html',
  JavaScript: 'application/javascript',
  Text: 'text/plain',
};

/** JSON metni JS, C#, Python ve Go'da da geçerli bir çift tırnaklı dize değişmezidir. */
const q = (value: string) => JSON.stringify(value);

interface Prepared {
  method: string;
  url: string;
  headers: { key: string; value: string }[];
  body: RequestBody;
  /** Raw/GraphQL gövdesinin metni (gerekirse). */
  text: string | null;
  fields: KeyValueItem[];
}

/** Yetkilendirmeyi header/URL'ye uygular, Content-Type'ı tamamlar; tüm üreticiler bunu kullanır. */
function prepare(request: CodeRequest): Prepared {
  const base = request.url.includes('://') || !request.url ? request.url : `http://${request.url}`;
  // Token gönderim anında alınır; kodda yer tutucu bırakılır.
  const applied = applyAuth(
    base,
    request.headers.filter((h) => h.enabled && h.key).map((h) => ({ key: h.key, value: h.value })),
    request.auth,
    '<access_token>',
  );
  const url = applied.url;
  const headers = applied.headers;
  const has = (name: string) => headers.some((h) => h.key.toLowerCase() === name.toLowerCase());

  const body = request.body;
  let text: string | null = null;
  if (body.mode === 'Raw' && body.raw) {
    text = body.raw;
    if (!has('Content-Type'))
      headers.push({ key: 'Content-Type', value: RAW_TYPES[body.rawLanguage] ?? 'text/plain' });
  } else if (body.mode === 'GraphQL') {
    let variables: unknown;
    try {
      variables = body.graphqlVariables?.trim() ? JSON.parse(body.graphqlVariables) : undefined;
    } catch {
      variables = undefined;
    }
    text = JSON.stringify(
      variables === undefined ? { query: body.raw } : { query: body.raw, variables },
      null,
      2,
    );
    if (!has('Content-Type')) headers.push({ key: 'Content-Type', value: 'application/json' });
  } else if (body.mode === 'UrlEncoded' && !has('Content-Type')) {
    headers.push({ key: 'Content-Type', value: 'application/x-www-form-urlencoded' });
  }

  return {
    method: request.method.toUpperCase(),
    url,
    headers,
    body,
    text,
    fields: body.form.filter((f) => f.enabled && f.key),
  };
}

const urlEncode = (fields: KeyValueItem[]) =>
  fields.map((f) => `${encodeURIComponent(f.key)}=${encodeURIComponent(f.value)}`).join('&');

// ------------------------------------------------------------------------------------------- C#

function csharp(p: Prepared): string {
  const lines = [
    'using var client = new HttpClient();',
    `var request = new HttpRequestMessage(new HttpMethod(${q(p.method)}), ${q(p.url)});`,
  ];
  const contentType = p.headers.find((h) => h.key.toLowerCase() === 'content-type')?.value;
  for (const h of p.headers) {
    if (h.key.toLowerCase() === 'content-type') continue;
    lines.push(`request.Headers.TryAddWithoutValidation(${q(h.key)}, ${q(h.value)});`);
  }
  if (p.text !== null) {
    const media = contentType?.split(';')[0]?.trim() ?? 'text/plain';
    lines.push(`request.Content = new StringContent(${q(p.text)}, System.Text.Encoding.UTF8, ${q(media)});`);
  } else if (p.body.mode === 'UrlEncoded') {
    lines.push('request.Content = new FormUrlEncodedContent(new Dictionary<string, string>');
    lines.push('{');
    for (const f of p.fields) lines.push(`    [${q(f.key)}] = ${q(f.value)},`);
    lines.push('});');
  } else if (p.body.mode === 'FormData') {
    lines.push('var form = new MultipartFormDataContent();');
    for (const f of p.fields) {
      if (f.type === 'File')
        lines.push(
          `form.Add(new ByteArrayContent(File.ReadAllBytes(${q(f.value)})), ${q(f.key)}, ${q(f.value)});`,
        );
      else lines.push(`form.Add(new StringContent(${q(f.value)}), ${q(f.key)});`);
    }
    lines.push('request.Content = form;');
  } else if (p.body.mode === 'Binary' && p.body.fileName) {
    lines.push(`request.Content = new ByteArrayContent(File.ReadAllBytes(${q(p.body.fileName)}));`);
    if (contentType)
      lines.push(`request.Content.Headers.TryAddWithoutValidation("Content-Type", ${q(contentType)});`);
  }
  lines.push(
    '',
    'var response = await client.SendAsync(request);',
    'Console.WriteLine((int)response.StatusCode);',
    'Console.WriteLine(await response.Content.ReadAsStringAsync());',
  );
  return lines.join('\n');
}

// ------------------------------------------------------------------------------------------- JS

function javascript(p: Prepared): string {
  const lines: string[] = [];
  const headers = p.headers.filter(
    (h) => !(p.body.mode === 'FormData' && h.key.toLowerCase() === 'content-type'),
  );
  let bodyExpr: string | null = null;
  if (p.text !== null) {
    bodyExpr = q(p.text);
  } else if (p.body.mode === 'UrlEncoded') {
    lines.push('const body = new URLSearchParams();');
    for (const f of p.fields) lines.push(`body.append(${q(f.key)}, ${q(f.value)});`);
    lines.push('');
    bodyExpr = 'body';
  } else if (p.body.mode === 'FormData') {
    lines.push('const body = new FormData();');
    for (const f of p.fields) {
      if (f.type === 'File')
        lines.push(`body.append(${q(f.key)}, dosyaInput.files[0], ${q(f.value)}); // ${f.value}`);
      else lines.push(`body.append(${q(f.key)}, ${q(f.value)});`);
    }
    lines.push('');
    bodyExpr = 'body';
  } else if (p.body.mode === 'Binary' && p.body.fileName) {
    bodyExpr = `dosyaInput.files[0] /* ${p.body.fileName} */`;
  }
  lines.push(`const response = await fetch(${q(p.url)}, {`);
  lines.push(`  method: ${q(p.method)},`);
  if (headers.length) {
    lines.push('  headers: {');
    for (const h of headers) lines.push(`    ${q(h.key)}: ${q(h.value)},`);
    lines.push('  },');
  }
  if (bodyExpr) lines.push(`  body: ${bodyExpr},`);
  lines.push('});', '', 'console.log(response.status);', 'console.log(await response.text());');
  return lines.join('\n');
}

// ------------------------------------------------------------------------------------------- Python

function python(p: Prepared): string {
  const lines = ['import requests', ''];
  const headers = p.headers.filter(
    (h) =>
      !(
        (p.body.mode === 'FormData' || p.body.mode === 'UrlEncoded') &&
        h.key.toLowerCase() === 'content-type'
      ),
  );
  lines.push(`url = ${q(p.url)}`);
  if (headers.length) {
    lines.push('headers = {');
    for (const h of headers) lines.push(`    ${q(h.key)}: ${q(h.value)},`);
    lines.push('}');
  }
  const args = ['url'];
  if (headers.length) args.push('headers=headers');
  if (p.text !== null) {
    lines.push(`payload = ${q(p.text)}`);
    args.push('data=payload.encode("utf-8")');
  } else if (p.body.mode === 'UrlEncoded') {
    lines.push('payload = {');
    for (const f of p.fields) lines.push(`    ${q(f.key)}: ${q(f.value)},`);
    lines.push('}');
    args.push('data=payload');
  } else if (p.body.mode === 'FormData') {
    const text = p.fields.filter((f) => f.type !== 'File');
    const files = p.fields.filter((f) => f.type === 'File');
    if (text.length) {
      lines.push('payload = {');
      for (const f of text) lines.push(`    ${q(f.key)}: ${q(f.value)},`);
      lines.push('}');
      args.push('data=payload');
    }
    if (files.length) {
      lines.push('files = {');
      for (const f of files) lines.push(`    ${q(f.key)}: open(${q(f.value)}, "rb"),`);
      lines.push('}');
      args.push('files=files');
    }
  } else if (p.body.mode === 'Binary' && p.body.fileName) {
    lines.push(`payload = open(${q(p.body.fileName)}, "rb").read()`);
    args.push('data=payload');
  }
  lines.push(
    '',
    `response = requests.request(${q(p.method)}, ${args.join(', ')})`,
    'print(response.status_code)',
    'print(response.text)',
  );
  return lines.join('\n');
}

// ------------------------------------------------------------------------------------------- Go

function go(p: Prepared): string {
  const imports = new Set(['fmt', 'io', 'net/http']);
  const pre: string[] = [];
  let bodyExpr = 'nil';
  let contentTypeOverride: string | null = null;
  if (p.text !== null) {
    imports.add('strings');
    bodyExpr = `strings.NewReader(${q(p.text)})`;
  } else if (p.body.mode === 'UrlEncoded') {
    imports.add('strings');
    bodyExpr = `strings.NewReader(${q(urlEncode(p.fields))})`;
  } else if (p.body.mode === 'FormData') {
    imports.add('bytes');
    imports.add('mime/multipart');
    pre.push('body := &bytes.Buffer{}', 'writer := multipart.NewWriter(body)');
    for (const f of p.fields) {
      if (f.type === 'File') {
        imports.add('os');
        pre.push(
          `fileData, _ := os.ReadFile(${q(f.value)})`,
          `part, _ := writer.CreateFormFile(${q(f.key)}, ${q(f.value)})`,
          'part.Write(fileData)',
        );
      } else {
        pre.push(`writer.WriteField(${q(f.key)}, ${q(f.value)})`);
      }
    }
    pre.push('writer.Close()', '');
    bodyExpr = 'body';
    contentTypeOverride = 'writer.FormDataContentType()';
  } else if (p.body.mode === 'Binary' && p.body.fileName) {
    imports.add('os');
    pre.push(`body, _ := os.Open(${q(p.body.fileName)})`, 'defer body.Close()', '');
    bodyExpr = 'body';
  }
  const lines = [
    'package main',
    '',
    'import (',
    ...[...imports].sort().map((i) => `\t${q(i)}`),
    ')',
    '',
    'func main() {',
    ...pre.map((l) => (l ? `\t${l}` : '')),
    `\treq, err := http.NewRequest(${q(p.method)}, ${q(p.url)}, ${bodyExpr})`,
    '\tif err != nil {',
    '\t\tpanic(err)',
    '\t}',
  ];
  for (const h of p.headers) {
    if (contentTypeOverride && h.key.toLowerCase() === 'content-type') continue;
    lines.push(`\treq.Header.Set(${q(h.key)}, ${q(h.value)})`);
  }
  if (contentTypeOverride) lines.push(`\treq.Header.Set("Content-Type", ${contentTypeOverride})`);
  lines.push(
    '',
    '\tres, err := http.DefaultClient.Do(req)',
    '\tif err != nil {',
    '\t\tpanic(err)',
    '\t}',
    '\tdefer res.Body.Close()',
    '\tdata, _ := io.ReadAll(res.Body)',
    '\tfmt.Println(res.StatusCode)',
    '\tfmt.Println(string(data))',
    '}',
  );
  return lines.join('\n');
}

// ------------------------------------------------------------------------------------------- PowerShell

const ps = (value: string) => `'${value.replace(/'/g, "''")}'`;

function powershell(p: Prepared): string {
  const lines: string[] = [];
  const headers = p.headers.filter((h) => h.key.toLowerCase() !== 'content-type');
  const contentType = p.headers.find((h) => h.key.toLowerCase() === 'content-type')?.value;
  if (headers.length) {
    lines.push('$headers = @{');
    for (const h of headers) lines.push(`    ${ps(h.key)} = ${ps(h.value)}`);
    lines.push('}');
  }
  const args = [`-Uri ${ps(p.url)}`, `-Method ${p.method}`];
  if (headers.length) args.push('-Headers $headers');
  if (p.text !== null) {
    lines.push("$body = @'", p.text, "'@");
    args.push('-Body ([System.Text.Encoding]::UTF8.GetBytes($body))');
    if (contentType) args.push(`-ContentType ${ps(contentType)}`);
  } else if (p.body.mode === 'UrlEncoded') {
    lines.push('$body = @{');
    for (const f of p.fields) lines.push(`    ${ps(f.key)} = ${ps(f.value)}`);
    lines.push('}');
    args.push('-Body $body', "-ContentType 'application/x-www-form-urlencoded'");
  } else if (p.body.mode === 'FormData') {
    lines.push('$form = @{');
    for (const f of p.fields)
      lines.push(`    ${ps(f.key)} = ${f.type === 'File' ? `Get-Item ${ps(f.value)}` : ps(f.value)}`);
    lines.push('}');
    args.push('-Form $form');
  } else if (p.body.mode === 'Binary' && p.body.fileName) {
    args.push(`-InFile ${ps(p.body.fileName)}`);
    if (contentType) args.push(`-ContentType ${ps(contentType)}`);
  }
  lines.push(`$response = Invoke-WebRequest ${args.join(' ')}`, '$response.StatusCode', '$response.Content');
  return lines.join('\n');
}

/** Kodun elle tamamlanması gereken yetkilendirme türleri için not (curl dışındaki diller). */
function authNote(request: CodeRequest): string | null {
  if (request.auth.type === 'Digest')
    return msg(
      'core.codegen.digestNote',
      'Digest yetkilendirmesi bu koda eklenmedi; kullandığınız kütüphanenin Digest desteğini kullanın.',
    );
  if (request.auth.type === 'AwsSigV4')
    return msg(
      'core.codegen.sigV4Note',
      'AWS Signature v4 imzası bu koda eklenmedi; AWS SDK ya da bir SigV4 imzalayıcısı kullanın.',
    );
  return null;
}

/** İsteği seçilen dilde çalışır bir kod parçasına çevirir. */
export function generateCode(language: CodeLanguage, request: CodeRequest): string {
  if (language === 'curl') return toCurl(request);
  const code = byLanguage(language, prepare(request));
  const note = authNote(request);
  if (!note) return code;
  const comment = language === 'python' || language === 'powershell' ? '#' : '//';
  return `${comment} ${note}\n${code}`;
}

function byLanguage(language: Exclude<CodeLanguage, 'curl'>, prepared: Prepared): string {
  switch (language) {
    case 'csharp':
      return csharp(prepared);
    case 'javascript':
      return javascript(prepared);
    case 'python':
      return python(prepared);
    case 'go':
      return go(prepared);
    case 'powershell':
      return powershell(prepared);
  }
}
