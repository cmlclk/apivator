import { describe, expect, it } from 'vitest';
import { mockCurl, mockUrl, samplePath } from './useMocks';

describe('mock yardımcıları', () => {
  it('yol parametrelerini örnek değerle doldurur', () => {
    expect(samplePath('/users/:id/orders/{orderId}')).toBe('/users/1/orders/1');
    expect(samplePath('/users/{{userId}}?status=active')).toBe('/users/1?status=active');
    expect(samplePath('/health')).toBe('/health');
  });

  it('adresi sunucu adresine ekler', () => {
    expect(mockUrl({ path: '/mock/abc' }, 'https://apivator.sirket.com/')).toBe(
      'https://apivator.sirket.com/mock/abc',
    );
  });

  it('curl komutuna method, tırnak ve gizli mock için anahtar ekler', () => {
    const base = 'http://localhost:5173';
    expect(mockCurl({ path: '/mock/abc', isPrivate: false }, '/users/1', base)).toBe(
      'curl http://localhost:5173/mock/abc/users/1',
    );
    expect(mockCurl({ path: '/mock/abc', isPrivate: false }, '/users?x=1', base, 'post')).toBe(
      'curl -X POST "http://localhost:5173/mock/abc/users?x=1"',
    );
    expect(mockCurl({ path: '/mock/abc', isPrivate: true }, '/', base)).toBe(
      'curl http://localhost:5173/mock/abc/ \\\n  -H "x-api-key: $APIVATOR_API_KEY"',
    );
  });
});
