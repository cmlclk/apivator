import { currentLanguage, translate, type MessageKey } from '../../i18n';

export interface Snippet {
  /** Arayüz metni; okunduğu anda etkin dilde döner. */
  readonly label: string;
  phase: 'preRequest' | 'postResponse' | 'both';
  /** Eklenecek kod; test adları ve örnek anahtarlar okunduğu anda etkin dilde döner. */
  readonly code: string;
}

const lines = (...items: string[]) => items.join('\n') + '\n';

function snippet(
  key: Extract<MessageKey<'scripts'>, `snippets.${string}`> extends `snippets.${infer K}` ? K : never,
  phase: Snippet['phase'],
  tr: string,
  en: string,
): Snippet {
  return {
    get label() {
      return translate('scripts', `snippets.${key}`);
    },
    phase,
    get code() {
      return currentLanguage() === 'en' ? en : tr;
    },
  };
}

/** Script editörünün yanındaki hazır parçalar (Postman'deki "Snippets"). */
export const snippets: Snippet[] = [
  snippet(
    'status200',
    'postResponse',
    lines('pm.test("Durum kodu 200", function () {', '    pm.response.to.have.status(200);', '});'),
    lines('pm.test("Status code is 200", function () {', '    pm.response.to.have.status(200);', '});'),
  ),
  snippet(
    'responseTime',
    'postResponse',
    lines(
      'pm.test("Yanıt süresi 500 ms altında", function () {',
      '    pm.expect(pm.response.responseTime).to.be.below(500);',
      '});',
    ),
    lines(
      'pm.test("Response time is below 500 ms", function () {',
      '    pm.expect(pm.response.responseTime).to.be.below(500);',
      '});',
    ),
  ),
  snippet(
    'jsonField',
    'postResponse',
    lines(
      'pm.test("JSON alanı doğru", function () {',
      '    const json = pm.response.json();',
      '    pm.expect(json.alan).to.eql("değer");',
      '});',
    ),
    lines(
      'pm.test("JSON field is correct", function () {',
      '    const json = pm.response.json();',
      '    pm.expect(json.field).to.eql("value");',
      '});',
    ),
  ),
  snippet(
    'bodyContains',
    'postResponse',
    lines(
      'pm.test("Gövde metni içeriyor", function () {',
      '    pm.expect(pm.response.text()).to.include("aranan");',
      '});',
    ),
    lines(
      'pm.test("Body contains text", function () {',
      '    pm.expect(pm.response.text()).to.include("needle");',
      '});',
    ),
  ),
  snippet(
    'headerExists',
    'postResponse',
    lines(
      `pm.test("Content-Type header'ı var", function () {`,
      '    pm.response.to.have.header("Content-Type");',
      '});',
    ),
    lines(
      'pm.test("Content-Type header exists", function () {',
      '    pm.response.to.have.header("Content-Type");',
      '});',
    ),
  ),
  snippet(
    'tokenToEnv',
    'postResponse',
    lines('const json = pm.response.json();', 'pm.environment.set("token", json.access_token);'),
    lines('const json = pm.response.json();', 'pm.environment.set("token", json.access_token);'),
  ),
  snippet(
    'envSet',
    'both',
    lines('pm.environment.set("anahtar", "değer");'),
    lines('pm.environment.set("key", "value");'),
  ),
  snippet(
    'envGet',
    'both',
    lines('const deger = pm.environment.get("anahtar");'),
    lines('const value = pm.environment.get("key");'),
  ),
  snippet(
    'collectionSet',
    'both',
    lines('pm.collectionVariables.set("anahtar", "değer");'),
    lines('pm.collectionVariables.set("key", "value");'),
  ),
  snippet(
    'addHeader',
    'preRequest',
    lines('pm.request.headers.upsert({ key: "X-Istek-Id", value: pm.variables.replaceIn("{{$guid}}") });'),
    lines('pm.request.headers.upsert({ key: "X-Request-Id", value: pm.variables.replaceIn("{{$guid}}") });'),
  ),
  snippet(
    'timestamp',
    'preRequest',
    lines('pm.variables.set("simdi", new Date().toISOString());'),
    lines('pm.variables.set("now", new Date().toISOString());'),
  ),
  snippet(
    'hmac',
    'preRequest',
    lines(
      'const govde = pm.request.body.raw || "";',
      'const imza = CryptoJS.HmacSHA256(govde, pm.environment.get("gizliAnahtar")).toString();',
      'pm.request.headers.upsert({ key: "X-Imza", value: imza });',
    ),
    lines(
      'const body = pm.request.body.raw || "";',
      'const signature = CryptoJS.HmacSHA256(body, pm.environment.get("secretKey")).toString();',
      'pm.request.headers.upsert({ key: "X-Signature", value: signature });',
    ),
  ),
  snippet(
    'sendRequest',
    'both',
    lines(
      'pm.sendRequest("https://api.ornek.com/saglik", function (err, res) {',
      '    if (err) { console.error(err); return; }',
      '    console.log(res.json());',
      '});',
    ),
    lines(
      'pm.sendRequest("https://api.example.com/health", function (err, res) {',
      '    if (err) { console.error(err); return; }',
      '    console.log(res.json());',
      '});',
    ),
  ),
  snippet(
    'setNext',
    'postResponse',
    lines('pm.execution.setNextRequest("İsteğin adı");'),
    lines('pm.execution.setNextRequest("Request name");'),
  ),
];
