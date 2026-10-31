  // Sandbox parçası 40: global'ler ve ev sahibi kancaları; IIFE'yi kapatır. Parça 00'daki IIFE'nin devamıdır.

  // ---------------------------------------------------------------- global'ler

  var consoleApi = {
    log: function () {
      log('log', arguments);
    },
    info: function () {
      log('info', arguments);
    },
    warn: function () {
      log('warn', arguments);
    },
    error: function () {
      log('error', arguments);
    },
    debug: function () {
      log('debug', arguments);
    },
  };

  global.pm = pm;
  global.console = consoleApi;
  global.atob = base64Decode;
  global.btoa = base64Encode;
  global.setTimeout = function (fn, delay) {
    if (typeof fn === 'function' && timers.length < 1000) timers.push({ fn: fn, delay: Number(delay) || 0, seq: timers.length });
    return timers.length;
  };
  global.clearTimeout = function (id) {
    if (timers[id - 1]) timers[id - 1].fn = null;
  };
  global.setInterval = function () {
    throw new Error('setInterval desteklenmiyor.');
  };
  var uuidModule = {
    v4: uuidV4,
    validate: function (value) {
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value));
    },
  };

  global.require = function (name) {
    switch (name) {
      case 'chai':
        return global.chai;
      case 'lodash':
        return global._;
      case 'crypto-js':
        return global.CryptoJS;
      case 'moment':
        return global.moment;
      case 'tv4':
        return global.tv4;
      case 'uuid':
        return uuidModule;
      case 'atob':
        return base64Decode;
      case 'btoa':
        return base64Encode;
      default:
        throw new Error(M('module_unsupported', { name: name }));
    }
  };
  global.xml2Json = xml2Json;

  // Eski (Postman v1) API'si: postman.*, tests[], responseBody...
  global.postman = {
    setEnvironmentVariable: function (k, v) {
      pm.environment.set(k, v);
    },
    getEnvironmentVariable: function (k) {
      return pm.environment.get(k);
    },
    clearEnvironmentVariable: function (k) {
      pm.environment.unset(k);
    },
    setGlobalVariable: function (k, v) {
      pm.globals.set(k, v);
    },
    getGlobalVariable: function (k) {
      return pm.globals.get(k);
    },
    clearGlobalVariable: function (k) {
      pm.globals.unset(k);
    },
    setNextRequest: function (name) {
      pm.execution.setNextRequest(name);
    },
  };
  global.environment = scopes.environment || {};
  global.globals = scopes.globals || {};
  global.data = scopes.data || {};
  global.iteration = pm.info.iteration;
  // Eski "request" nesnesi: o anki isteğin salt okunur özeti.
  global.request = {
    url: request.url,
    method: request.method,
    headers: (request.headers || []).reduce(function (all, h) {
      if (h.enabled !== false) all[h.key] = h.value;
      return all;
    }, {}),
    data: request.body && request.body.mode === 'Raw' ? request.body.raw : {},
  };
  global.tests = {};
  // Eski sandbox'taki responseBody.has('…') gibi kullanımlar için.
  if (!String.prototype.has) {
    Object.defineProperty(String.prototype, 'has', {
      value: function (part) {
        return this.indexOf(part) >= 0;
      },
      enumerable: false,
      configurable: true,
      writable: true,
    });
  }
  if (pm.response) {
    global.responseBody = pm.response.text();
    global.responseCode = { code: input.response.status, name: input.response.statusText, detail: input.response.statusText };
    global.responseTime = input.response.timeMs;
    global.responseHeaders = pm.response.headers.toObject();
  }

  // ---------------------------------------------------------------- ev sahibi kancaları

  global.__beforeScript = function () {
    global.tests = {};
  };

  global.__afterScript = function () {
    var legacy = global.tests;
    for (var name in legacy) {
      if (Object.prototype.hasOwnProperty.call(legacy, name)) {
        tests.push({ name: name, status: legacy[name] ? 'passed' : 'failed', error: legacy[name] ? null : 'tests["' + name + '"] false' });
      }
    }
    global.tests = {};
  };

  global.__drainTimers = function () {
    var guard = 0;
    while (timers.some(function (t) {
      return t.fn;
    }) && guard++ < 1000) {
      var next = null;
      timers.forEach(function (t) {
        if (t.fn && (!next || t.delay < next.delay || (t.delay === next.delay && t.seq < next.seq))) next = t;
      });
      var fn = next.fn;
      next.fn = null;
      try {
        fn();
      } catch (e) {
        log('error', [e]);
      }
    }
  };

  global.__logError = function (message) {
    log('error', [String(message)]);
  };

  global.__finish = function () {
    tests.forEach(function (t) {
      if (t.status === 'pending') {
        t.status = 'failed';
        t.error = M('async_incomplete');
      }
    });
    return JSON.stringify({
      request: request,
      variables: { environment: scopes.environment, collection: scopes.collection, globals: scopes.globals },
      local: scopes.local,
      tests: tests,
      console: logs,
      nextRequest: nextRequest,
      skip: skip,
    });
  };
})(globalThis);
