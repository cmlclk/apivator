import { describe, expect, it } from 'vitest';
import { FormatError } from './formatError';
import { formatHtml, minifyHtml } from './htmlFormat';

const PAGE = `<!DOCTYPE html>
<html lang="tr"><head><meta charset="utf-8"><title>  Başlık   korunur </title>
<style>
  body { color: red; }
</style>
<script>if (a < b && c > d) { document.write("</div>"); }</script></head>
<body class=ana data-x='1' hidden>
<!-- gezinti -->
<nav><ul><li><a href="/">Ana    sayfa</a><li>İkinci <b>kalın</b>
</ul></nav>
<p>Merhaba
   <em>dünya</em>, <br>yeni satır<img src="a.png" alt="">
<div>blok<input disabled /></div>
<pre>  önceden
    biçimli   <b>metin</b>
</pre>
<textarea name="t">  ham
  </textarea>
</body></html>`;

const PAGE_EXPECTED = `<!DOCTYPE html>
<html lang="tr">
  <head>
    <meta charset="utf-8">
    <title>  Başlık   korunur </title>
    <style>
  body { color: red; }
</style>
    <script>if (a < b && c > d) { document.write("</div>"); }</script>
  </head>
  <body class=ana data-x='1' hidden>
    <!-- gezinti -->
    <nav>
      <ul>
        <li><a href="/">Ana sayfa</a>
        <li>İkinci <b>kalın</b>
      </ul>
    </nav>
    <p>Merhaba <em>dünya</em>, <br>yeni satır<img src="a.png" alt="">
    <div>blok<input disabled /></div>
    <pre>  önceden
    biçimli   <b>metin</b>
</pre>
    <textarea name="t">  ham
  </textarea>
  </body>
</html>`;

function errorOf(text: string): FormatError {
  try {
    formatHtml(text);
  } catch (error) {
    if (error instanceof FormatError) return error;
    throw error;
  }
  throw new Error('hata bekleniyordu');
}

describe('formatHtml', () => {
  it('girintiler; DOCTYPE, yorum, boş öğeler, örtük kapanma ve korunan içerik', () => {
    expect(formatHtml(PAGE)).toBe(PAGE_EXPECTED);
  });

  it('idempotent (2, 4 ve sekme)', () => {
    for (const indent of [2, 4, '\t'] as const) {
      const once = formatHtml(PAGE, { indent });
      expect(formatHtml(once, { indent })).toBe(once);
    }
  });

  it('küçültür; küçültülmüş metin aynı biçime döner', () => {
    const min = minifyHtml(PAGE);
    expect(min).toContain('<html lang="tr"><head><meta charset="utf-8"><title>');
    expect(min).toContain('<p>Merhaba <em>dünya</em>, <br>yeni satır<img src="a.png" alt=""><div>');
    expect(min).toContain('<pre>  önceden\n    biçimli   <b>metin</b>\n</pre>');
    expect(formatHtml(min)).toBe(PAGE_EXPECTED);
    expect(minifyHtml(min)).toBe(min);
  });

  it('küçültmede satır içi öğe sınırındaki boşluk korunur, yorum istenirse atılır', () => {
    expect(minifyHtml('<div>\n  a\n  <span> b </span>\n  c\n</div>')).toBe('<div>a <span> b </span> c</div>');
    expect(minifyHtml('<div> <!-- x --> <p>a</p> </div>', { removeComments: true })).toBe(
      '<div><p>a</p></div>',
    );
    expect(minifyHtml('<div> <!-- x --> <p>a</p> </div>')).toBe('<div><!-- x --><p>a</p></div>');
  });

  it('satır içi öğe blok içerirse alt alta yazılır', () => {
    expect(formatHtml('<a href="#"><div>x</div> y</a>')).toBe('<a href="#">\n  <div>x</div>\n  y\n</a>');
  });

  it('öznitelikleri yazıldığı gibi korur, eşittir çevresindeki boşluğu atar', () => {
    expect(formatHtml(`<div   id = "a"  class='b c'  data-json='{"x": 1}'   @click="f()" :y=z></div>`)).toBe(
      `<div id="a" class='b c' data-json='{"x": 1}' @click="f()" :y=z></div>`,
    );
  });

  it('etiket adının büyük/küçük harfini korur; kapanışı harften bağımsız eşler', () => {
    expect(formatHtml('<DIV><P>a</p></Div>')).toBe('<DIV>\n  <P>a</p>\n</Div>');
  });

  it('tek başına < metin olarak, eşleşmeyen kapanış etiketi kendi satırında kalır', () => {
    expect(formatHtml('<div>a < b</span></div>')).toBe('<div>\n  a < b\n  </span>\n</div>');
    expect(formatHtml('<div><p>a</div></span>')).toBe('<div>\n  <p>a\n</div>\n</span>');
  });

  it('tablo ve liste örtük kapanmaları', () => {
    const table = '<table><tr><td>1<td>2<tr><td>3</table>';
    expect(formatHtml(table)).toBe('<table>\n  <tr>\n    <td>1\n    <td>2\n  <tr>\n    <td>3\n</table>');
    expect(formatHtml(formatHtml(table))).toBe(formatHtml(table));
    expect(minifyHtml(formatHtml(table))).toBe(table);
  });

  it('SVG ve kendi kendini kapatan öğeler', () => {
    expect(formatHtml('<svg viewBox="0 0 1 1"><path d="M0 0"/><g><circle r="1"/></g></svg>')).toBe(
      '<svg viewBox="0 0 1 1">\n  <path d="M0 0" />\n  <g>\n    <circle r="1" />\n  </g>\n</svg>',
    );
  });

  it('script içindeki etiket benzeri metin ve kapanmamış script', () => {
    expect(formatHtml('<div><script>var s = "<p>";</script></div>')).toBe(
      '<div>\n  <script>var s = "<p>";</script>\n</div>',
    );
    expect(formatHtml('<script>a < b')).toBe('<script>a < b');
  });

  it('boş girdi ve yalnızca metin', () => {
    expect(formatHtml('')).toBe('');
    expect(formatHtml('  merhaba   dünya  ')).toBe('merhaba dünya');
  });

  it.each([
    ['<div><!-- açık', 'Yorum kapanmamış', 1, 6],
    ['<div>\n  <a href="x', 'tırnağı kapanmamış', 2, 11],
    ['<div class="a"', 'etiketi kapanmamış', 1, 1],
    ['<p>a</p', 'etiketi kapanmamış', 1, 5],
    ['<!DOCTYPE html', 'Bildirim kapanmamış', 1, 1],
  ])('hatalı HTML: %s', (text, reason, line, column) => {
    const error = errorOf(text);
    expect(error.message).toContain(reason);
    expect({ line: error.line, column: error.column }).toEqual({ line, column });
  });
});
