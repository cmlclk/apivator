// Sandbox parçası 00: giriş — IIFE açılışı, yardımcılar ve değişkenler. Parçalar ada göre birleştirilip tek kaynak olarak çalışır (kapanış: 40-kancalar.js).
/*
 * Apivator script ortamı: Postman'in pm API'sinin uyumlu bir alt kümesi.
 *
 * Motordan bağımsızdır (Jint, QuickJS...). Ev sahibi şunları sağlar:
 *   __input            : girdi (JSON metni) — istek, yanıt, değişkenler, bilgi
 *   __hostSend(json)   : pm.sendRequest için HTTP isteği atar, yanıtı JSON metni olarak döner
 *   __hostDynamic(ad)  : dinamik değişkenin ({{$randomEmail}}…) yeni değeri; bilinmeyen adda null
 *   __msg(kimlik, {ad: metin}) : Apivator'ın kendi ileti metni, etkin dilde (pm.expect/chai iletilerine karışmaz)
 * Ev sahibi her script'i __runScript(index, kaynak) ile değil, kendi sarmalayıcısıyla çalıştırır ve sonunda
 * __finish() çağırıp çıktıyı (JSON metni) alır.
 */
(function (global) {
  'use strict';

  var input = JSON.parse(global.__input);
  var phase = input.phase; // 'prerequest' | 'test'
  var request = input.request;
  var vars = input.variables || {};
  var scopes = {
    local: vars.local || {},
    data: vars.data || {},
    environment: vars.environment || null,
    collection: vars.collection || null,
    globals: vars.globals || null,
  };
  var tests = [];
  var logs = [];
  var nextRequest = null;
  var skip = false;
  var timers = [];
  var MAX_LOGS = 500;

  // ---------------------------------------------------------------- yardımcılar

  function str(value) {
    if (value === undefined) return 'undefined';
    if (value === null) return 'null';
    if (typeof value === 'string') return value;
    if (value instanceof Error) return value.name + ': ' + value.message;
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value, null, 2);
      } catch (e) {
        return String(value);
      }
    }
    return String(value);
  }

  function log(level, args) {
    if (logs.length >= MAX_LOGS) return;
    var parts = [];
    for (var i = 0; i < args.length; i++) parts.push(str(args[i]));
    var message = parts.join(' ');
    if (message.length > 10000) message = message.substring(0, 10000) + '…';
    logs.push({ level: level, message: message, phase: phase });
  }

  function lower(s) {
    return String(s).toLowerCase();
  }

  // ---------------------------------------------------------------- değişkenler

  /**
   * Dinamik değişkenler ({{$guid}}, {{$randomEmail}}…) ev sahibinde üretilir (__hostDynamic → DynamicValues):
   * istemci, runner ve script aynı ad listesini, biçimleri ve kriptografik rastgeleliği paylaşır. Ev sahibi
   * yalnızca ad alıp metin (ya da bilinmeyen adda null) döner.
   */
  var hostDynamic = global.__hostDynamic;
  var hostMsg = global.__msg;
  // Değerler JS String() ile metne çevrilir (dizi "a,b"); ev sahibine yalnızca düz metinler gider.
  function M(id, args) {
    var plain = {};
    if (args) for (var k in args) if (Object.prototype.hasOwnProperty.call(args, k)) plain[k] = String(args[k]);
    return hostMsg(id, plain);
  }

  function dynamic(name) {
    if (typeof name !== 'string' || name.charAt(0) !== '$' || typeof hostDynamic !== 'function') return undefined;
    var value = hostDynamic(name);
    return value === null || value === undefined ? undefined : String(value);
  }

  function uuidV4() {
    return dynamic('$randomUUID');
  }

  var LOOKUP_ORDER = ['local', 'data', 'environment', 'collection', 'globals'];

  /** typedResult: script'in koyduğu tipli değeri döndür (pm.variables.get); değilse saklanan metin (replaceIn). */
  function lookup(name, typedResult) {
    for (var i = 0; i < LOOKUP_ORDER.length; i++) {
      var key = LOOKUP_ORDER[i];
      var scope = scopes[key];
      if (scope && Object.prototype.hasOwnProperty.call(scope, name))
        return typedResult ? typedValue(key, name, scope[name]) : scope[name];
    }
    return undefined;
  }

  function replaceIn(text) {
    if (typeof text !== 'string' || text.indexOf('{{') < 0) return text;
    var current = text;
    for (var depth = 0; depth < 10; depth++) {
      var changed = false;
      current = current.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, function (match, raw) {
        var name = raw.trim();
        var value = lookup(name);
        if (value === undefined) value = dynamic(name);
        if (value === undefined) return match;
        changed = true;
        return String(value);
      });
      if (!changed) break;
    }
    return current;
  }

  function toStored(value) {
    if (value === undefined || value === null) return '';
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  }

  // Script'in koyduğu değerin tipi bu çalıştırma boyunca korunur (Postman'deki gibi set(7) → get() === 7).
  // Saklanırken metne çevrilir; sonraki isteklerde değer metin olarak gelir.
  var typed = { local: {}, environment: {}, collection: {}, globals: {} };

  function remember(key, k, value) {
    if (typed[key]) typed[key][k] = { value: value, stored: toStored(value) };
  }

  function typedValue(key, k, stored) {
    var entry = typed[key] && Object.prototype.hasOwnProperty.call(typed[key], k) ? typed[key][k] : null;
    return entry && entry.stored === stored ? entry.value : stored;
  }

  function Scope(key, label) {
    function target() {
      if (!scopes[key]) {
        if (key === 'environment') throw new Error(M('env_missing'));
        scopes[key] = {};
      }
      return scopes[key];
    }
    return {
      name: label,
      get: function (k) {
        var s = scopes[key];
        return s && Object.prototype.hasOwnProperty.call(s, k) ? typedValue(key, k, s[k]) : undefined;
      },
      set: function (k, v) {
        if (key === 'data') throw new Error('pm.iterationData salt okunurdur.');
        target()[String(k)] = toStored(v);
        remember(key, String(k), v);
      },
      unset: function (k) {
        var s = scopes[key];
        if (s) delete s[k];
        if (typed[key]) delete typed[key][k];
      },
      has: function (k) {
        var s = scopes[key];
        return !!s && Object.prototype.hasOwnProperty.call(s, k);
      },
      clear: function () {
        if (scopes[key]) scopes[key] = {};
        if (typed[key]) typed[key] = {};
      },
      toObject: function () {
        var copy = {};
        var s = scopes[key] || {};
        for (var k in s) if (Object.prototype.hasOwnProperty.call(s, k)) copy[k] = s[k];
        return copy;
      },
      replaceIn: replaceIn,
    };
  }

