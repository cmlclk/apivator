import { describe, expect, it } from 'vitest';
import { mentionQuery, mentionToken, parseComment } from './mentions';

const id = '0193a5b2-1111-7222-8333-944445555666';

describe('bahsetmeler', () => {
  it('gövdeyi metin ve bahsetme parçalarına ayırır', () => {
    expect(parseComment(`Merhaba ${mentionToken('Ayşe Yılmaz', id)}, bakar mısın?`)).toEqual([
      { kind: 'text', text: 'Merhaba ' },
      { kind: 'mention', name: 'Ayşe Yılmaz', userId: id },
      { kind: 'text', text: ', bakar mısın?' },
    ]);
  });

  it('imleç solundaki @sorguyu bulur, e-postayı değil', () => {
    expect(mentionQuery('selam @ay', 9)).toEqual({ start: 6, query: 'ay' });
    expect(mentionQuery('@', 1)).toEqual({ start: 0, query: '' });
    expect(mentionQuery('ayse@ornek.com', 14)).toBeNull();
    expect(mentionQuery('selam @ay bitti', 15)).toBeNull();
  });
});

describe('düzenlenebilir metin', () => {
  it('saklanan biçim ile "@Ad" arasında gidip gelir', async () => {
    const { toEditable, toStored } = await import('./mentions');
    const other = '0193a5b2-2222-7222-8333-944445555666';
    const body = `${mentionToken('Ayşe', other)} ve ${mentionToken('Ayşe Yılmaz', id)} bakın`;
    const { text, mentions } = toEditable(body);
    expect(text).toBe('@Ayşe ve @Ayşe Yılmaz bakın');
    expect(toStored(text, mentions)).toBe(body);
  });
});
