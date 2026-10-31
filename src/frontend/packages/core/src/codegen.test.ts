import { describe, expect, it } from 'vitest';
import { CODE_LANGUAGES, generateCode, type CodeRequest } from './codegen';
import { emptyAuth, emptyBody } from './http';

const json: CodeRequest = {
  method: 'post',
  url: 'https://api.test/kullanicilar?sayfa=1',
  headers: [
    { key: 'X-Izleme', value: 'a"b', enabled: true },
    { key: 'X-Kapali', value: '1', enabled: false },
  ],
  body: { ...emptyBody(), mode: 'Raw', rawLanguage: 'Json', raw: '{\n  "ad": "Ayşe"\n}' },
  auth: { ...emptyAuth('Bearer'), bearerToken: 'tkn' },
};

describe('generateCode', () => {
  it('produces code for every language', () => {
    for (const { id } of CODE_LANGUAGES) {
      const code = generateCode(id, json);
      expect(code, id).toContain('api.test/kullanicilar');
      expect(code, id).not.toContain('X-Kapali');
      expect(code, id).toContain('Bearer tkn');
    }
  });

  it('escapes strings and sets content type', () => {
    const csharp = generateCode('csharp', json);
    expect(csharp).toContain('"X-Izleme", "a\\"b"');
    expect(csharp).toContain(
      'new StringContent("{\\n  \\"ad\\": \\"Ayşe\\"\\n}", System.Text.Encoding.UTF8, "application/json")',
    );
    expect(generateCode('javascript', json)).toContain('method: "POST"');
    expect(generateCode('python', json)).toContain(
      'requests.request("POST", url, headers=headers, data=payload.encode("utf-8"))',
    );
    expect(generateCode('powershell', json)).toContain("-ContentType 'application/json'");
  });

  it('handles basic auth, query api keys and forms', () => {
    const basic = generateCode('javascript', {
      ...json,
      body: emptyBody(),
      auth: { ...emptyAuth('Basic'), basicUsername: 'ayşe', basicPassword: 'ş' },
    });
    expect(basic).toContain(
      `"Authorization": "Basic ${btoa(String.fromCharCode(...new TextEncoder().encode('ayşe:ş')))}"`,
    );

    const form: CodeRequest = {
      method: 'POST',
      url: 'api.test/yukle',
      headers: [],
      body: {
        ...emptyBody(),
        mode: 'FormData',
        form: [
          { key: 'aciklama', value: 'Ekim', enabled: true },
          { key: 'dosya', value: 'dekont.pdf', enabled: true, type: 'File' },
        ],
      },
      auth: { ...emptyAuth('ApiKey'), apiKeyName: 'key', apiKeyValue: 'v 1', apiKeyIn: 'Query' },
    };
    expect(generateCode('python', form)).toContain('"dosya": open("dekont.pdf", "rb")');
    expect(generateCode('python', form)).toContain('url = "http://api.test/yukle?key=v%201"');
    const goCode = generateCode('go', form);
    expect(goCode).toContain('writer.CreateFormFile("dosya", "dekont.pdf")');
    expect(goCode).toContain('req.Header.Set("Content-Type", writer.FormDataContentType())');
  });
});

describe('gelişmiş yetkilendirme', () => {
  const base = {
    method: 'GET',
    url: 'https://api.example.com/x',
    headers: [],
    body: emptyBody(),
  };

  it('OAuth 2.0 için Authorization header ekler (token yoksa yer tutucu)', () => {
    const code = generateCode('python', {
      ...base,
      auth: { ...emptyAuth('OAuth2'), oAuth2HeaderPrefix: 'Bearer' },
    });
    expect(code).toContain('"Authorization": "Bearer <access_token>"');
  });

  it('curl Digest ve AWS imzasını kendi seçenekleriyle üretir', () => {
    const digest = generateCode('curl', {
      ...base,
      auth: { ...emptyAuth('Digest'), basicUsername: 'a', basicPassword: 'b' },
    });
    expect(digest).toContain('--digest');
    expect(digest).toContain('-u a:b');
    const aws = generateCode('curl', {
      ...base,
      auth: {
        ...emptyAuth('AwsSigV4'),
        awsAccessKey: 'AK',
        awsSecretKey: 'SK',
        awsRegion: 'eu-west-1',
        awsService: 's3',
      },
    });
    expect(aws).toContain('--aws-sigv4 aws:amz:eu-west-1:s3');
    expect(aws).toContain('-u AK:SK');
  });

  it('diğer dillerde Digest/AWS için not düşer', () => {
    expect(generateCode('go', { ...base, auth: emptyAuth('AwsSigV4') })).toMatch(/^\/\/ AWS Signature v4/);
    expect(generateCode('powershell', { ...base, auth: emptyAuth('Digest') })).toMatch(/^# Digest/);
  });
});
