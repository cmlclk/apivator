import { afterEach, describe, expect, it } from 'vitest';
import en from './locales/en/core.json';
import { registerCoreMessages, setCoreLanguage } from './i18n';
import { CurlParseError, looksLikeCurl, parseCurl, tokenizeShell, toCurl } from './curl';
import { emptyAuth, emptyBody } from './http';

describe('tokenizeShell', () => {
  it('handles quotes, ANSI-C strings and continuations', () => {
    expect(tokenizeShell(`curl 'a b' "c \\"d\\"" $'e\\nf' g\\ h \\\n  -X`)).toEqual([
      'curl',
      'a b',
      'c "d"',
      'e\nf',
      'g h',
      '-X',
    ]);
  });

  it('handles Windows cmd escaping', () => {
    expect(tokenizeShell('curl ^"https://x.test/a?b=1^&c=2^" ^\n  -H ^"accept: */*^"')).toEqual([
      'curl',
      'https://x.test/a?b=1&c=2',
      '-H',
      'accept: */*',
    ]);
  });

  it('throws on unclosed quotes', () => {
    expect(() => tokenizeShell(`curl 'abc`)).toThrow(CurlParseError);
  });
});

describe('parseCurl', () => {
  it('detects curl commands', () => {
    expect(looksLikeCurl('  curl https://x.test')).toBe(true);
    expect(looksLikeCurl('https://x.test/curl')).toBe(false);
  });

  it('parses a Chrome-style JSON POST', () => {
    const { definition, hasAuth, warnings } = parseCurl(
      `curl 'https://api.test/users' \\
  -H 'accept: application/json' \\
  -H 'content-type: application/json' \\
  -H 'authorization: Bearer abc.def' \\
  --data-raw '{"name":"Ayşe","age":30}' \\
  --compressed`,
    );
    expect(definition.method).toBe('POST');
    expect(definition.url).toBe('https://api.test/users');
    expect(definition.headers.map((h) => h.key)).toEqual(['accept', 'content-type']);
    expect(definition.body.mode).toBe('Raw');
    expect(definition.body.rawLanguage).toBe('Json');
    expect(JSON.parse(definition.body.raw)).toEqual({ name: 'Ayşe', age: 30 });
    expect(hasAuth).toBe(true);
    expect(definition.auth.type).toBe('Bearer');
    expect(definition.auth.bearerToken).toBe('abc.def');
    expect(warnings).toEqual([]);
  });

  it('parses form data, urlencoded and basic auth', () => {
    const urlencoded = parseCurl(
      `curl -u admin:s3cr3t -d 'grant_type=client_credentials&scope=a%20b' https://auth.test/token`,
    );
    expect(urlencoded.definition.method).toBe('POST');
    expect(urlencoded.definition.body.mode).toBe('UrlEncoded');
    expect(urlencoded.definition.body.form).toEqual([
      { key: 'grant_type', value: 'client_credentials', enabled: true },
      { key: 'scope', value: 'a b', enabled: true },
    ]);
    expect(urlencoded.definition.auth).toMatchObject({
      type: 'Basic',
      basicUsername: 'admin',
      basicPassword: 's3cr3t',
    });

    const multipart = parseCurl(`curl -F name=Ekim -F file=@/tmp/x.pdf -XPUT https://x.test/up`);
    expect(multipart.definition.method).toBe('PUT');
    expect(multipart.definition.body.mode).toBe('FormData');
    expect(multipart.definition.body.form).toEqual([
      { key: 'name', value: 'Ekim', enabled: true },
      { key: 'file', value: 'x.pdf', enabled: true, type: 'File' },
    ]);
    expect(multipart.warnings).toHaveLength(1);

    const binary = parseCurl(
      `curl --data-binary @./veri/rapor.csv -H 'Content-Type: text/csv' https://x.test/up`,
    );
    expect(binary.definition.method).toBe('POST');
    expect(binary.definition.body).toMatchObject({ mode: 'Binary', fileName: 'rapor.csv' });
  });

  it('supports -G, -I, combined flags, --url and --json', () => {
    expect(parseCurl(`curl -G https://x.test/s -d q=1 --data-urlencode 'n=a b'`).definition).toMatchObject({
      method: 'GET',
      url: 'https://x.test/s?q=1&n=a%20b',
    });
    expect(parseCurl('curl -sSLI https://x.test').definition.method).toBe('HEAD');
    expect(parseCurl('curl --request=DELETE --url=https://x.test/1').definition).toMatchObject({
      method: 'DELETE',
      url: 'https://x.test/1',
    });
    const json = parseCurl(`curl --json '{"a":1}' https://x.test`).definition;
    expect(json.headers.map((h) => h.key)).toEqual(['Content-Type', 'Accept']);
    expect(json.body.rawLanguage).toBe('Json');
  });

  it('keeps plain text bodies and reports unknown options', () => {
    const result = parseCurl(
      `curl -H 'Content-Type: text/plain' -d 'merhaba dünya' --frobnicate https://x.test`,
    );
    expect(result.definition.body).toMatchObject({ mode: 'Raw', rawLanguage: 'Text', raw: 'merhaba dünya' });
    expect(result.warnings).toEqual(['Bilinmeyen seçenek atlandı: --frobnicate']);
    expect(result.hasAuth).toBe(false);
  });

  it('rejects input without url or curl', () => {
    expect(() => parseCurl('wget https://x.test')).toThrow(CurlParseError);
    expect(() => parseCurl('curl -X POST')).toThrow(CurlParseError);
  });
});

describe('toCurl', () => {
  it('writes files and GraphQL bodies', () => {
    const base = { method: 'POST', url: 'https://x.test', headers: [], auth: emptyAuth('None') };
    expect(
      toCurl({
        ...base,
        body: {
          ...emptyBody(),
          mode: 'FormData',
          form: [{ key: 'f', value: 'a b.pdf', enabled: true, type: 'File' }],
        },
      }),
    ).toContain("-F 'f=@a b.pdf'");
    expect(toCurl({ ...base, body: { ...emptyBody(), mode: 'Binary', fileName: 'x.bin' } })).toContain(
      '--data-binary @x.bin',
    );
    const graphql = parseCurl(
      toCurl({
        ...base,
        body: { ...emptyBody(), mode: 'GraphQL', raw: '{ a }', graphqlVariables: '{"n":1}' },
      }),
    ).definition;
    expect(JSON.parse(graphql.body.raw)).toEqual({ query: '{ a }', variables: { n: 1 } });
  });

  it('round-trips through parseCurl', () => {
    const original = {
      method: 'PATCH',
      url: "https://x.test/it's",
      headers: [
        { key: 'X-Trace', value: '1', enabled: true },
        { key: 'X-Off', value: '1', enabled: false },
      ],
      body: {
        ...emptyBody(),
        mode: 'Raw' as const,
        rawLanguage: 'Json' as const,
        raw: '{\n  "a": "b\'c"\n}',
      },
      auth: { ...emptyAuth('Bearer'), bearerToken: 'tok' },
    };
    const command = toCurl(original);
    expect(command).toContain('-X PATCH');
    const parsed = parseCurl(command).definition;
    expect(parsed.method).toBe('PATCH');
    expect(parsed.url).toBe(original.url);
    expect(parsed.headers.map((h) => `${h.key}: ${h.value}`)).toEqual([
      'X-Trace: 1',
      'Content-Type: application/json',
    ]);
    expect(JSON.parse(parsed.body.raw)).toEqual({ a: "b'c" });
    expect(parsed.auth.bearerToken).toBe('tok');
  });

  it('writes query api keys and urlencoded bodies', () => {
    const command = toCurl({
      method: 'POST',
      url: 'https://x.test/a?b=1',
      headers: [],
      body: { ...emptyBody(), mode: 'UrlEncoded', form: [{ key: 'q', value: 'a b', enabled: true }] },
      auth: { ...emptyAuth('ApiKey'), apiKeyName: 'k', apiKeyValue: 'v', apiKeyIn: 'Query' },
    });
    expect(command).toBe("curl \\\n  'https://x.test/a?b=1&k=v' \\\n  --data-urlencode 'q=a b'");
  });
});

describe('curl messages (en)', () => {
  afterEach(() => setCoreLanguage('tr'));

  it('reports errors and warnings in English', () => {
    registerCoreMessages('en', { core: en });
    setCoreLanguage('en');
    expect(() => parseCurl('curl')).toThrow('No URL found in the command.');
    expect(() => parseCurl('wget x')).toThrow('The command must start with "curl".');
    expect(parseCurl('curl --foo https://a.test').warnings).toEqual(['Unknown option skipped: --foo']);
  });
});
