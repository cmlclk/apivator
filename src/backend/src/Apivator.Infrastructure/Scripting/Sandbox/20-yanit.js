  // Sandbox parçası 20: xml2Json ve yanıt (pm.response, chai). Parça 00'daki IIFE'nin devamıdır.

  // ---------------------------------------------------------------- xml2Json

  /**
   * Postman'deki xml2Json ile aynı biçim (xml2js, explicitArray: false): kök öğe adıyla sarılır, öznitelikler "$",
   * öznitelik ya da alt öğesi olan öğenin metni "_" altında; tek metinli öğe düz metin, boş öğe ''; aynı adlı
   * kardeşler dizi olur. Ad alanı önekleri adın parçasıdır ("soap:Envelope").
   */
  function xml2Json(source) {
    var text = String(source);
    var pos = 0;

    function decode(value) {
      return value.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, function (m, e) {
        if (e === 'lt') return '<';
        if (e === 'gt') return '>';
        if (e === 'amp') return '&';
        if (e === 'quot') return '"';
        if (e === 'apos') return "'";
        return String.fromCharCode(e.charAt(1) === 'x' ? parseInt(e.substring(2), 16) : parseInt(e.substring(1), 10));
      });
    }

    function fail(message) {
      throw new Error('xml2Json: ' + message + ' (' + M('xml_pos', { pos: pos }) + ')');
    }

    function skipMisc() {
      for (;;) {
        while (pos < text.length && /\s/.test(text.charAt(pos))) pos++;
        if (text.substr(pos, 4) === '<!--') {
          var end = text.indexOf('-->', pos);
          if (end < 0) fail(M('xml_comment'));
          pos = end + 3;
        } else if (text.substr(pos, 2) === '<?') {
          var close = text.indexOf('?>', pos);
          if (close < 0) fail(M('xml_pi'));
          pos = close + 2;
        } else if (text.substr(pos, 9) === '<!DOCTYPE') {
          var gt = text.indexOf('>', pos);
          if (gt < 0) fail('kapanmayan DOCTYPE');
          pos = gt + 1;
        } else {
          return;
        }
      }
    }

    function add(target, name, value) {
      if (!Object.prototype.hasOwnProperty.call(target, name)) target[name] = value;
      else if (Array.isArray(target[name])) target[name].push(value);
      else target[name] = [target[name], value];
    }

    function element() {
      if (text.charAt(pos) !== '<') fail(M('xml_element'));
      pos++;
      var nameMatch = /^[^\s/>]+/.exec(text.substring(pos));
      if (!nameMatch) fail(M('xml_name'));
      var name = nameMatch[0];
      pos += name.length;
      var attrs = null;
      for (;;) {
        while (/\s/.test(text.charAt(pos))) pos++;
        var c = text.charAt(pos);
        if (c === '/' && text.charAt(pos + 1) === '>') {
          pos += 2;
          return { name: name, value: attrs ? { $: attrs } : '' };
        }
        if (c === '>') {
          pos++;
          break;
        }
        var attr = /^([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/.exec(text.substring(pos));
        if (!attr) fail(M('xml_attr'));
        attrs = attrs || {};
        attrs[attr[1]] = decode(attr[3] !== undefined ? attr[3] : attr[4]);
        pos += attr[0].length;
      }
      var children = {};
      var hasChildren = false;
      var content = '';
      for (;;) {
        if (pos >= text.length) fail(M('xml_unclosed', { name: name }));
        if (text.substr(pos, 2) === '</') {
          var end = text.indexOf('>', pos);
          var closing = text.substring(pos + 2, end).trim();
          if (closing !== name) fail('"' + name + '" bekleniyordu, "' + closing + '" geldi');
          pos = end + 1;
          break;
        }
        if (text.substr(pos, 9) === '<![CDATA[') {
          var cdataEnd = text.indexOf(']]>', pos);
          if (cdataEnd < 0) fail('kapanmayan CDATA');
          content += text.substring(pos + 9, cdataEnd);
          pos = cdataEnd + 3;
        } else if (text.substr(pos, 4) === '<!--') {
          var commentEnd = text.indexOf('-->', pos);
          if (commentEnd < 0) fail('kapanmayan yorum');
          pos = commentEnd + 3;
        } else if (text.charAt(pos) === '<') {
          var child = element();
          hasChildren = true;
          add(children, child.name, child.value);
        } else {
          var next = text.indexOf('<', pos);
          if (next < 0) next = text.length;
          content += decode(text.substring(pos, next));
          pos = next;
        }
      }
      content = content.trim();
      if (!hasChildren && !attrs) return { name: name, value: content };
      var value = attrs ? { $: attrs } : {};
      for (var key in children) if (Object.prototype.hasOwnProperty.call(children, key)) value[key] = children[key];
      if (content) value._ = content;
      return { name: name, value: value };
    }

    skipMisc();
    var root = element();
    var result = {};
    result[root.name] = root.value;
    return result;
  }

  // ---------------------------------------------------------------- yanıt

  function base64Decode(input) {
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
    var output = '';
    var clean = String(input).replace(/[^A-Za-z0-9+/=]/g, '');
    for (var i = 0; i < clean.length; ) {
      var e1 = chars.indexOf(clean.charAt(i++));
      var e2 = chars.indexOf(clean.charAt(i++));
      var e3 = chars.indexOf(clean.charAt(i++));
      var e4 = chars.indexOf(clean.charAt(i++));
      var c1 = (e1 << 2) | (e2 >> 4);
      var c2 = ((e2 & 15) << 4) | (e3 >> 2);
      var c3 = ((e3 & 3) << 6) | e4;
      output += String.fromCharCode(c1);
      if (e3 !== 64 && e3 !== -1) output += String.fromCharCode(c2);
      if (e4 !== 64 && e4 !== -1) output += String.fromCharCode(c3);
    }
    return output;
  }

  function base64Encode(input) {
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
    var s = String(input);
    var output = '';
    for (var i = 0; i < s.length; ) {
      var c1 = s.charCodeAt(i++);
      var c2 = s.charCodeAt(i++);
      var c3 = s.charCodeAt(i++);
      if (c1 > 255 || c2 > 255 || c3 > 255) throw new Error(M('btoa_latin1'));
      var e1 = c1 >> 2;
      var e2 = ((c1 & 3) << 4) | (c2 >> 4);
      var e3 = isNaN(c2) ? 64 : ((c2 & 15) << 2) | (c3 >> 6);
      var e4 = isNaN(c3) ? 64 : c3 & 63;
      output += chars.charAt(e1) + chars.charAt(e2) + chars.charAt(e3) + chars.charAt(e4);
    }
    return output;
  }

  function AssertionFailure(message) {
    var error = new Error(message);
    error.name = 'AssertionError';
    return error;
  }

  function makeResponse(data) {
    var headers = PropertyList(
      function () {
        return (data.headers || []).map(function (h) {
          return { key: h.key, value: h.value, enabled: true };
        });
      },
      function () {},
      true,
    );
    var text = data.bodyEncoding === 'base64' ? base64Decode(data.body || '') : data.body || '';

    function json() {
      try {
        return JSON.parse(text);
      } catch (e) {
        var error = new Error(M('json_invalid', { detail: e.message }));
        error.name = 'JSONError';
        throw error;
      }
    }

    function assertion(negate) {
      // Olumsuz iletinin kimliği '.not' ekler; olumsuzlamada hiç başarısız olmayan denetimlerin olumsuz iletisi yoktur.
      function check(ok, id, args) {
        if (negate ? ok : !ok) throw AssertionFailure(M(negate ? id + '.not' : id, args));
      }
      function statusIn(min, max, label) {
        return function () {
          check(data.status >= min && data.status <= max, 'status_in', { label: label, status: data.status });
        };
      }
      function getter(target, name, fn) {
        Object.defineProperty(target, name, { get: fn, enumerable: true });
      }
      var api = {
        status: function (expected) {
          if (typeof expected === 'number') {
            check(data.status === expected, 'status_code', { expected: expected, actual: data.status });
          } else {
            check(lower(data.statusText || '') === lower(expected), 'status_text', { expected: expected, actual: data.statusText });
          }
        },
        header: function (key, value) {
          var has = headers.has(key);
          if (value === undefined) {
            check(has, 'header_has', { key: key });
          } else {
            check(has && headers.get(key) === String(value), 'header_value', { key: key, value: String(value), actual: headers.get(key) });
          }
        },
        body: function (expected) {
          if (expected === undefined) {
            check(text.length > 0, 'body_present');
          } else if (expected instanceof RegExp) {
            check(expected.test(text), 'body_regex', { expected: String(expected) });
          } else {
            check(text === String(expected), 'body_equal', { expected: String(expected) });
          }
        },
        // Şema doğrulama tv4 ile (JSON Schema draft-04 anahtar kelimeleri; bilinmeyenler yok sayılır).
        jsonSchema: function (schema) {
          if (!global.tv4) throw new Error(M('schema_unavailable'));
          var parsed;
          try {
            parsed = JSON.parse(text);
          } catch (e) {
            check(false, 'body_json');
            return;
          }
          var result = global.tv4.validateMultiple(parsed, schema);
          var detail = (result.errors || [])
            .slice(0, 5)
            .map(function (e) {
              return (e.dataPath || '/') + ': ' + e.message;
            })
            .join('; ');
          check(result.valid, 'schema_invalid', { detail: detail });
        },
        jsonBody: function (path, value) {
          var parsed;
          try {
            parsed = JSON.parse(text);
          } catch (e) {
            check(false, 'body_json');
            return;
          }
          if (path === undefined) return;
          var current = parsed;
          var parts = String(path).replace(/\[(\d+)\]/g, '.$1').split('.');
          for (var i = 0; i < parts.length; i++) {
            if (current === null || current === undefined || !(parts[i] in Object(current))) {
              check(false, 'json_path', { path: path });
              return;
            }
            current = current[parts[i]];
          }
          if (arguments.length > 1) {
            check(JSON.stringify(current) === JSON.stringify(value), 'json_value', { path: path, value: str(value), actual: str(current) });
          }
        },
      };
      var be = {};
      getter(be, 'ok', statusIn(200, 299, 'success'));
      getter(be, 'success', statusIn(200, 299, 'success'));
      getter(be, 'info', statusIn(100, 199, '1xx'));
      getter(be, 'redirection', statusIn(300, 399, 'redirection'));
      getter(be, 'clientError', statusIn(400, 499, 'client_error'));
      getter(be, 'serverError', statusIn(500, 599, 'server_error'));
      getter(be, 'error', statusIn(400, 599, 'error'));
      getter(be, 'badRequest', statusIn(400, 400, '400'));
      getter(be, 'unauthorized', statusIn(401, 401, '401'));
      getter(be, 'forbidden', statusIn(403, 403, '403'));
      getter(be, 'notFound', statusIn(404, 404, '404'));
      getter(be, 'rateLimited', statusIn(429, 429, '429'));
      getter(be, 'accepted', statusIn(202, 202, '202'));
      getter(be, 'withBody', function () {
        check(text.length > 0, 'body_present');
      });
      getter(be, 'html', function () {
        var type = headers.get('content-type') || '';
        check(/html/i.test(type), 'type_html', { type: type });
      });
      getter(be, 'xml', function () {
        var type = headers.get('content-type') || '';
        check(/xml/i.test(type), 'type_xml', { type: type });
      });
      getter(be, 'json', function () {
        var type = headers.get('content-type') || '';
        check(/json/i.test(type), 'type_json', { type: type });
      });
      var chain = { have: api, be: be };
      getter(chain, 'not', function () {
        return assertion(!negate);
      });
      chain.has = api;
      return chain;
    }

    var cookieList = function () {
      var result = [];
      headers.all().forEach(function (h) {
        if (lower(h.key) !== 'set-cookie') return;
        var pair = h.value.split(';')[0];
        var eq = pair.indexOf('=');
        if (eq > 0) result.push({ name: pair.substring(0, eq).trim(), value: pair.substring(eq + 1).trim() });
      });
      return result;
    };

    var response = {
      code: data.status,
      status: data.statusText,
      responseTime: data.timeMs,
      responseSize: data.size,
      headers: headers,
      size: function () {
        var header = 0;
        headers.all().forEach(function (h) {
          header += String(h.key).length + String(h.value).length + 4;
        });
        var body = typeof data.size === 'number' ? data.size : text.length;
        return { body: body, header: header, total: body + header };
      },
      text: function () {
        return text;
      },
      json: json,
      reason: function () {
        return data.statusText;
      },
      cookies: {
        get: function (name) {
          var all = cookieList();
          for (var i = 0; i < all.length; i++) if (all[i].name === name) return all[i].value;
          return undefined;
        },
        toObject: function () {
          var result = {};
          cookieList().forEach(function (c) {
            result[c.name] = c.value;
          });
          return result;
        },
        all: function () {
          return cookieList();
        },
        has: function (name) {
          return this.get(name) !== undefined;
        },
      },
    };
    Object.defineProperty(response, 'to', {
      get: function () {
        return assertion(false);
      },
    });
    return response;
  }

