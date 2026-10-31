import { describe, expect, it } from 'vitest';
import {
  emptyAuth,
  formatBytes,
  formatDuration,
  normalizeDefinition,
  parseQueryParams,
  prettyJson,
  resolveAuth,
  withQueryParams,
} from './http';
import type { CollectionTreeDto } from './types';

describe('query parametreleri', () => {
  it('URL içindeki parametreleri çözmeden okur', () => {
    expect(parseQueryParams('https://x.test/a?q=api%20test&flag&id={{userId}}#top')).toEqual([
      { key: 'q', value: 'api%20test', enabled: true },
      { key: 'flag', value: '', enabled: true },
      { key: 'id', value: '{{userId}}', enabled: true },
    ]);
  });

  it('query yoksa boş liste döner', () => {
    expect(parseQueryParams('https://x.test/a')).toEqual([]);
    expect(parseQueryParams('')).toEqual([]);
  });

  it("tablodan URL üretirken adresi ve fragment'i korur", () => {
    const url = withQueryParams('https://x.test/a?old=1#top', [
      { key: 'page', value: '2', enabled: true },
      { key: 'gizli', value: 'x', enabled: false },
      { key: 'flag', value: '', enabled: true },
    ]);
    expect(url).toBe('https://x.test/a?page=2&flag#top');
  });

  it('tüm parametreler silinince ? işareti kalkar', () => {
    expect(withQueryParams('https://x.test/a?x=1', [])).toBe('https://x.test/a');
  });

  it("gidiş-dönüş URL'yi bozmaz", () => {
    const url = 'http://localhost:5000/api/users?sort=name&filter={{f}}';
    expect(withQueryParams(url, parseQueryParams(url))).toBe(url);
  });
});

describe('biçimlendirme', () => {
  it.each([
    [512, '512 B'],
    [2048, '2.0 KB'],
    [50 * 1024, '50 KB'],
    [3 * 1024 * 1024, '3.0 MB'],
  ])('%d bayt → %s', (bytes, text) => expect(formatBytes(bytes)).toBe(text));

  it.each([
    [42.4, '42 ms'],
    [1234, '1.23 s'],
    [12_345, '12.3 s'],
  ])('%d ms → %s', (ms, text) => expect(formatDuration(ms)).toBe(text));

  it("geçerli JSON'u girintiler, geçersizi olduğu gibi bırakır", () => {
    expect(prettyJson('{"a":1}')).toEqual({ text: '{\n  "a": 1\n}', isJson: true });
    expect(prettyJson('<html/>')).toEqual({ text: '<html/>', isJson: false });
    expect(prettyJson('{bozuk')).toEqual({ text: '{bozuk', isJson: false });
  });
});

describe('yetkilendirme mirası', () => {
  const bearer = { ...emptyAuth('Bearer'), bearerToken: 'col' };
  const basic = { ...emptyAuth('Basic'), basicUsername: 'u' };
  const collection: CollectionTreeDto = {
    id: 'c',
    workspaceId: 'w',
    name: 'Ödeme API',
    description: null,
    auth: bearer,
    variables: [],
    scripts: { preRequest: '', postResponse: '' },
    folders: [
      {
        id: 'f1',
        parentFolderId: null,
        name: 'Yönetim',
        sortOrder: 0,
        auth: basic,
        scripts: { preRequest: '', postResponse: '' },
      },
      {
        id: 'f2',
        parentFolderId: 'f1',
        name: 'Kullanıcılar',
        sortOrder: 0,
        auth: emptyAuth('Inherit'),
        scripts: { preRequest: '', postResponse: '' },
      },
      {
        id: 'f3',
        parentFolderId: null,
        name: 'Genel',
        sortOrder: 1,
        auth: emptyAuth('Inherit'),
        scripts: { preRequest: '', postResponse: '' },
      },
    ],
    requests: [],
    examples: [],
  };

  it('kendi yetkilendirmesi olan istek onu kullanır', () => {
    const own = { ...emptyAuth('ApiKey'), apiKeyName: 'k' };
    expect(resolveAuth(own, 'f2', collection)).toEqual({ auth: own, source: null });
  });

  it('miras alan istek en yakın yetkilendirilmiş üst klasörü bulur', () => {
    expect(resolveAuth(emptyAuth(), 'f2', collection)).toEqual({
      auth: basic,
      source: { kind: 'folder', name: 'Yönetim' },
    });
  });

  it('klasörler de miras alıyorsa collection kullanılır', () => {
    expect(resolveAuth(emptyAuth(), 'f3', collection)).toEqual({
      auth: bearer,
      source: { kind: 'collection', name: 'Ödeme API' },
    });
    expect(resolveAuth(emptyAuth(), null, collection).auth).toEqual(bearer);
  });

  it('auth alanı olmayan eski kayıtta çökmez, miras alır', () => {
    expect(resolveAuth(undefined, 'f3', collection).auth).toEqual(bearer);
  });

  it('kaydedilmemiş istekte yetkilendirme yoktur', () => {
    expect(resolveAuth(emptyAuth(), null, undefined)).toEqual({ auth: emptyAuth('None'), source: null });
  });

  it('eski kayıtlarda eksik auth alanı miras alma olarak okunur', () => {
    expect(normalizeDefinition({ method: 'get', url: 'x' }).auth.type).toBe('Inherit');
  });
});
