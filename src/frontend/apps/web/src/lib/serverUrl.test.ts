import { describe, expect, it } from 'vitest';
import { normalizeServerUrl } from './serverUrl';

describe('normalizeServerUrl', () => {
  it('sondaki eğik çizgileri atar, yolu korur', () => {
    expect(normalizeServerUrl(' https://api.example.com/ ')).toEqual({ url: 'https://api.example.com' });
    expect(normalizeServerUrl('http://10.0.0.5:5080/apivator//')).toEqual({
      url: 'http://10.0.0.5:5080/apivator',
    });
  });

  it('geçersiz ya da http dışı adresleri reddeder', () => {
    expect(normalizeServerUrl('api.example.com')).toHaveProperty('error');
    expect(normalizeServerUrl('ftp://api.example.com')).toHaveProperty('error');
  });
});
