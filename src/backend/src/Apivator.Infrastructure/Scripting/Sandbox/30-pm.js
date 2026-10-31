  // Sandbox parçası 30: pm.sendRequest, testler ve pm nesnesi. Parça 00'daki IIFE'nin devamıdır.

  // ---------------------------------------------------------------- pm.sendRequest

  var bodyFromPostman = function (body) {
    if (!body) return { mode: 'None', raw: '', form: [], rawLanguage: 'Json', graphqlVariables: '' };
    var form = function (list) {
      return (list || []).map(function (i) {
        return { key: String(i.key), value: i.value === undefined ? '' : String(i.value), enabled: i.disabled !== true };
      });
    };
    switch (body.mode) {
      case 'urlencoded':
        return { mode: 'UrlEncoded', raw: '', form: form(body.urlencoded), rawLanguage: 'Json', graphqlVariables: '' };
      case 'formdata':
        return { mode: 'FormData', raw: '', form: form(body.formdata), rawLanguage: 'Json', graphqlVariables: '' };
      case 'graphql':
        return {
          mode: 'GraphQL',
          raw: (body.graphql && body.graphql.query) || '',
          form: [],
          rawLanguage: 'Json',
          graphqlVariables: body.graphql && body.graphql.variables ? str(body.graphql.variables) : '',
        };
      default:
        return { mode: 'Raw', raw: typeof body.raw === 'string' ? body.raw : str(body.raw || ''), form: [], rawLanguage: 'Text', graphqlVariables: '' };
    }
  };

  function headersFromPostman(header) {
    if (!header) return [];
    if (Array.isArray(header)) {
      return header.map(function (h) {
        if (typeof h === 'string') {
          var c = h.indexOf(':');
          return { key: h.substring(0, c).trim(), value: h.substring(c + 1).trim(), enabled: true };
        }
        return { key: String(h.key), value: String(h.value), enabled: h.disabled !== true };
      });
    }
    return Object.keys(header).map(function (k) {
      return { key: k, value: String(header[k]), enabled: true };
    });
  }

  function sendRequest(req, callback) {
    var spec = typeof req === 'string' ? { url: req, method: 'GET' } : req || {};
    var payload = {
      method: String(spec.method || 'GET').toUpperCase(),
      url: replaceIn(typeof spec.url === 'string' ? spec.url : spec.url && spec.url.toString ? spec.url.toString() : String(spec.url)),
      headers: headersFromPostman(spec.header || spec.headers),
      body: bodyFromPostman(spec.body),
    };
    var result;
    var error = null;
    try {
      result = JSON.parse(global.__hostSend(JSON.stringify(payload)));
      if (result.error) error = new Error(result.error.message);
    } catch (e) {
      error = e;
    }
    var response = error ? null : makeResponse(result);
    if (typeof callback === 'function') {
      callback(error, response);
      return undefined;
    }
    return error ? Promise.reject(error) : Promise.resolve(response);
  }

  // ---------------------------------------------------------------- testler

  function recordFailure(entry, e) {
    entry.status = 'failed';
    entry.error = e && e.message !== undefined ? (e.name && e.name !== 'Error' ? e.name + ': ' : '') + e.message : str(e);
  }

  function test(name, fn) {
    var entry = { name: String(name), status: 'passed', error: null };
    tests.push(entry);
    if (typeof fn !== 'function') {
      entry.status = 'skipped';
      return pm;
    }
    try {
      var result = fn();
      if (result && typeof result.then === 'function') {
        entry.status = 'pending';
        result.then(
          function () {
            entry.status = 'passed';
          },
          function (e) {
            recordFailure(entry, e);
          },
        );
      }
    } catch (e) {
      recordFailure(entry, e);
    }
    return pm;
  }
  test.skip = function (name) {
    tests.push({ name: String(name), status: 'skipped', error: null });
    return pm;
  };

  // ---------------------------------------------------------------- pm

  var requestApi = makeRequest(request, phase !== 'prerequest');

  var pm = {
    info: {
      eventName: phase,
      iteration: (input.info && input.info.iteration) || 0,
      iterationCount: (input.info && input.info.iterationCount) || 1,
      requestName: (input.info && input.info.requestName) || '',
      requestId: (input.info && input.info.requestId) || '',
    },
    environment: Scope('environment', vars.environmentName || ''),
    collectionVariables: Scope('collection', ''),
    globals: Scope('globals', ''),
    iterationData: Scope('data', ''),
    variables: {
      get: function (key) {
        return lookup(key, true);
      },
      set: function (key, value) {
        scopes.local[String(key)] = toStored(value);
        remember('local', String(key), value);
      },
      unset: function (key) {
        delete scopes.local[key];
        delete typed.local[key];
      },
      has: function (key) {
        return lookup(key) !== undefined;
      },
      toObject: function () {
        var merged = {};
        [scopes.globals, scopes.collection, scopes.environment, scopes.data, scopes.local].forEach(function (s) {
          if (s) for (var k in s) if (Object.prototype.hasOwnProperty.call(s, k)) merged[k] = s[k];
        });
        return merged;
      },
      replaceIn: replaceIn,
    },
    request: requestApi,
    test: test,
    sendRequest: sendRequest,
    execution: {
      setNextRequest: function (name) {
        nextRequest = { value: name === null || name === undefined ? null : String(name) };
      },
      skipRequest: function () {
        if (phase !== 'prerequest') throw new Error(M('skip_prerequest'));
        skip = true;
      },
      location: [],
    },
  };

  Object.defineProperty(pm, 'expect', {
    get: function () {
      if (!global.chai) throw new Error(M('expect_unavailable'));
      return global.chai.expect;
    },
  });

  if (phase === 'test' && input.response) {
    pm.response = makeResponse(input.response);
  }

  // pm.cookies: Postman'de isteğin alan adına ait çerezler; burada yanıtın Set-Cookie başlıkları.
  pm.cookies = pm.response
    ? pm.response.cookies
    : {
        get: function () {
          return undefined;
        },
        has: function () {
          return false;
        },
        toObject: function () {
          return {};
        },
        all: function () {
          return [];
        },
      };

