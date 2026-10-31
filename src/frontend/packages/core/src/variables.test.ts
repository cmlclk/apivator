import { describe, expect, it } from 'vitest';
import { emptyAuth, emptyBody } from './http';
import { ibanValid, luhnValid, tcknValid } from './tools/fakeDataChecks';
import {
  buildVariableMap,
  isDynamicVariable,
  resolveRequest,
  resolveText,
  splitVariables,
  type VariableScope,
} from './variables';

const v = (key: string, value: string, extra: Partial<{ enabled: boolean; isSecret: boolean }> = {}) => ({
  key,
  value,
  enabled: true,
  isSecret: false,
  ...extra,
});

const scopes: VariableScope[] = [
  {
    kind: 'global',
    name: 'Globals',
    variables: [v('baseUrl', 'https://global.test'), v('version', 'v1')],
    current: {},
  },
  {
    kind: 'collection',
    name: 'Ödeme API',
    variables: [v('baseUrl', 'https://col.test'), v('path', '/users')],
    current: {},
  },
  {
    kind: 'environment',
    name: 'Geliştirme',
    variables: [
      v('baseUrl', 'http://localhost:5000'),
      v('token', '', { isSecret: true }),
      v('kapali', 'x', { enabled: false }),
    ],
    current: { token: 'gizli-123' },
  },
];

describe('değişken haritası', () => {
  it("environment collection'ı, collection global'i ezer", () => {
    const map = buildVariableMap(scopes);
    expect(map.get('baseUrl')).toMatchObject({ value: 'http://localhost:5000', scope: 'environment' });
    expect(map.get('path')).toMatchObject({ value: '/users', scope: 'collection' });
    expect(map.get('version')).toMatchObject({ value: 'v1', scope: 'global' });
  });

  it('güncel değer başlangıç değerinin yerine geçer', () => {
    expect(buildVariableMap(scopes).get('token')).toMatchObject({ value: 'gizli-123', isSecret: true });
  });

  it('kapalı değişkenler yok sayılır', () => {
    expect(buildVariableMap(scopes).has('kapali')).toBe(false);
  });

  it('güncel değer bilerek boş bırakıldıysa boş kullanılır', () => {
    const map = buildVariableMap([
      { kind: 'global', name: 'G', variables: [v('a', 'başlangıç')], current: { a: '' } },
    ]);
    expect(map.get('a')?.value).toBe('');
  });
});

describe('metin çözümleme', () => {
  const map = buildVariableMap(scopes);

  it('değişkenleri çözer, boşluklara izin verir', () => {
    expect(resolveText('{{baseUrl}}{{ path }}?v={{version}}', map).text).toBe(
      'http://localhost:5000/users?v=v1',
    );
  });

  it('tanımsız değişkenleri bırakır ve listeler', () => {
    const result = resolveText('{{baseUrl}}/{{bilinmeyen}}', map);
    expect(result.text).toBe('http://localhost:5000/{{bilinmeyen}}');
    expect([...result.unresolved]).toEqual(['bilinmeyen']);
  });

  it('iç içe değişkenleri çözer, döngüde takılmaz', () => {
    const nested = buildVariableMap([
      {
        kind: 'global',
        name: 'G',
        variables: [v('host', 'api.test'), v('url', 'https://{{host}}'), v('a', '{{b}}'), v('b', '{{a}}')],
        current: {},
      },
    ]);
    expect(resolveText('{{url}}/x', nested).text).toBe('https://api.test/x');
    expect(() => resolveText('{{a}}', nested)).not.toThrow();
  });

  it('dinamik değişkenleri üretir', () => {
    const empty = buildVariableMap([]);
    expect(resolveText('{{$guid}}', empty).text).toMatch(/^[0-9a-f-]{36}$/);
    expect(resolveText('{{$timestamp}}', empty).text).toMatch(/^\d{10}$/);
    expect(Number(resolveText('{{$randomInt}}', empty).text)).toBeLessThanOrEqual(1000);
  });

  it('eski dinamik değişkenler aynı biçimde kalır', () => {
    const empty = buildVariableMap([]);
    for (let i = 0; i < 200; i++) {
      expect(resolveText('{{$randomUUID}}', empty).text).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(resolveText('{{$randomInt}}', empty).text).toMatch(/^(\d{1,3}|1000)$/);
    }
    expect(resolveText('{{$isoTimestamp}}', empty).text).toMatch(/^\d{4}-\d\d-\d\dT[\d:.]+Z$/);
    expect(resolveText('{{ $guid }}', empty).unresolved.size).toBe(0);
  });

  it('sahte veri değişkenleri araç üretecinden gelir; tanımlı değişken önceliklidir', () => {
    const empty = buildVariableMap([]);
    expect(resolveText('{{$randomEmail}}', empty).text).toMatch(/@(example\.(com|net|org)|[a-z]+\.test)$/);
    expect(tcknValid(resolveText('{{$randomTckn}}', empty).text)).toBe(true);
    expect(ibanValid(resolveText('{{$randomIban}}', empty).text)).toBe(true);
    expect(luhnValid(resolveText('{{$randomCreditCardNumber}}', empty).text)).toBe(true);
    expect(isDynamicVariable('$randomFullName')).toBe(true);
    expect(isDynamicVariable('$timestamp')).toBe(true);
    expect(isDynamicVariable('$yok')).toBe(false);
    expect(isDynamicVariable('$__proto__')).toBe(false);
    expect(resolveText('{{$yok}}', empty).unresolved.has('$yok')).toBe(true);
    const own = buildVariableMap([
      { kind: 'global', name: 'G', variables: [v('$randomEmail', 'sabit@example.com')], current: {} },
    ]);
    expect(resolveText('{{$randomEmail}}', own).text).toBe('sabit@example.com');
  });
});

describe('istek çözümleme', () => {
  it('URL, header, body ve yetkilendirmedeki değişkenleri çözer', () => {
    const result = resolveRequest(
      {
        url: '{{baseUrl}}{{path}}',
        headers: [
          { key: 'X-Version', value: '{{version}}', enabled: true },
          { key: 'X-Kapali', value: '{{yok}}', enabled: false },
        ],
        body: { ...emptyBody(), mode: 'Raw', raw: '{"v":"{{version}}"}' },
        auth: { ...emptyAuth('Bearer'), bearerToken: '{{token}}' },
      },
      buildVariableMap(scopes),
    );

    expect(result.url).toBe('http://localhost:5000/users');
    expect(result.headers[0]!.value).toBe('v1');
    expect(result.headers[1]!.value).toBe('{{yok}}');
    expect(result.body.raw).toBe('{"v":"v1"}');
    expect(result.auth.bearerToken).toBe('gizli-123');
    expect(result.unresolved).toEqual([]);
  });
});

describe('vurgulama', () => {
  it('metni değişken ve düz parçalara böler', () => {
    expect(splitVariables('{{baseUrl}}/users/{{ id }}?x=1')).toEqual([
      { text: '{{baseUrl}}', variable: 'baseUrl' },
      { text: '/users/' },
      { text: '{{ id }}', variable: 'id' },
      { text: '?x=1' },
    ]);
  });
});
