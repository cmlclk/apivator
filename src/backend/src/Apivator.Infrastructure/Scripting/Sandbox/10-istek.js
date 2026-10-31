  // Sandbox parçası 10: liste nesneleri (header, query) ve pm.request. Parça 00'daki IIFE'nin devamıdır.

  // ---------------------------------------------------------------- liste nesneleri (header, query)

  function PropertyList(getItems, setItems, readOnly) {
    function items() {
      return getItems();
    }
    function find(key) {
      var all = items();
      for (var i = all.length - 1; i >= 0; i--) {
        if (lower(all[i].key) === lower(key) && all[i].enabled !== false) return all[i];
      }
      return undefined;
    }
    function guard() {
      if (readOnly) throw new Error('Bu liste salt okunurdur.');
    }
    function normalize(item, value) {
      if (typeof item === 'string') {
        var colon = item.indexOf(':');
        return value !== undefined
          ? { key: item, value: String(value), enabled: true }
          : { key: item.substring(0, colon).trim(), value: item.substring(colon + 1).trim(), enabled: true };
      }
      return { key: String(item.key), value: item.value === undefined ? '' : String(item.value), enabled: item.disabled !== true };
    }
    return {
      get: function (key) {
        var item = find(key);
        return item ? item.value : undefined;
      },
      has: function (key, value) {
        var item = find(key);
        return !!item && (value === undefined || item.value === String(value));
      },
      one: function (key) {
        return find(key);
      },
      all: function () {
        return items().filter(function (i) {
          return i.enabled !== false;
        });
      },
      count: function () {
        return this.all().length;
      },
      each: function (fn) {
        this.all().forEach(fn);
      },
      map: function (fn) {
        return this.all().map(fn);
      },
      filter: function (fn) {
        return this.all().filter(fn);
      },
      toObject: function () {
        var o = {};
        this.all().forEach(function (i) {
          o[i.key] = i.value;
        });
        return o;
      },
      add: function (item, value) {
        guard();
        setItems(items().concat([normalize(item, value)]));
      },
      upsert: function (item, value) {
        guard();
        var next = normalize(item, value);
        var all = items();
        var found = false;
        var updated = all.map(function (i) {
          if (!found && lower(i.key) === lower(next.key)) {
            found = true;
            return next;
          }
          return i;
        });
        setItems(found ? updated : all.concat([next]));
      },
      remove: function (key) {
        guard();
        var predicate =
          typeof key === 'function'
            ? key
            : function (i) {
                return lower(i.key) === lower(key);
              };
        setItems(
          items().filter(function (i) {
            return !predicate(i);
          }),
        );
      },
      clear: function () {
        guard();
        setItems([]);
      },
    };
  }

  // ---------------------------------------------------------------- pm.request

  function splitUrl(url) {
    var hash = url.indexOf('#');
    if (hash >= 0) url = url.substring(0, hash);
    var q = url.indexOf('?');
    return { base: q >= 0 ? url.substring(0, q) : url, query: q >= 0 ? url.substring(q + 1) : '' };
  }

  function parseQuery(query) {
    if (!query) return [];
    return query.split('&').map(function (pair) {
      var eq = pair.indexOf('=');
      return eq < 0
        ? { key: pair, value: null, enabled: true }
        : { key: pair.substring(0, eq), value: pair.substring(eq + 1), enabled: true };
    });
  }

  function buildUrl(base, items) {
    var q = items
      .filter(function (i) {
        return i.enabled !== false;
      })
      .map(function (i) {
        return i.value === null || i.value === undefined ? i.key : i.key + '=' + i.value;
      })
      .join('&');
    return q ? base + '?' + q : base;
  }

  var bodyModes = { None: 'none', Raw: 'raw', UrlEncoded: 'urlencoded', FormData: 'formdata', Binary: 'file', GraphQL: 'graphql' };
  var bodyModesBack = { none: 'None', raw: 'Raw', urlencoded: 'UrlEncoded', formdata: 'FormData', file: 'Binary', graphql: 'GraphQL' };

  function makeRequest(model, readOnly) {
    function guard() {
      if (readOnly) throw new Error(M('request_readonly'));
    }
    model.headers = model.headers || [];
    model.body = model.body || { mode: 'None', raw: '', form: [], rawLanguage: 'Json', graphqlVariables: '' };

    var url = {
      toString: function () {
        return model.url;
      },
      update: function (value) {
        guard();
        model.url = String(value);
      },
      getHost: function () {
        var m = /^(?:[a-z]+:\/\/)?([^/?#:]+)/i.exec(model.url);
        return m ? m[1] : '';
      },
      getPath: function () {
        var m = /^(?:[a-z]+:\/\/[^/?#]*)?([^?#]*)/i.exec(model.url);
        return m && m[1] ? m[1] : '/';
      },
      getQueryString: function () {
        return splitUrl(model.url).query;
      },
      query: PropertyList(
        function () {
          return parseQuery(splitUrl(model.url).query);
        },
        function (items) {
          guard();
          model.url = buildUrl(splitUrl(model.url).base, items);
        },
        readOnly,
      ),
    };

    var body = {
      get mode() {
        return bodyModes[model.body.mode] || 'none';
      },
      set mode(value) {
        guard();
        model.body.mode = bodyModesBack[value] || 'None';
      },
      get raw() {
        return model.body.raw;
      },
      set raw(value) {
        guard();
        model.body.raw = String(value);
        if (model.body.mode === 'None') model.body.mode = 'Raw';
      },
      update: function (value) {
        guard();
        if (typeof value === 'string') {
          model.body.mode = 'Raw';
          model.body.raw = value;
        } else if (value && value.mode) {
          model.body.mode = bodyModesBack[value.mode] || 'Raw';
          if (value.raw !== undefined) model.body.raw = String(value.raw);
        }
      },
      urlencoded: PropertyList(
        function () {
          return model.body.form;
        },
        function (items) {
          guard();
          model.body.form = items;
        },
        readOnly,
      ),
      formdata: PropertyList(
        function () {
          return model.body.form;
        },
        function (items) {
          guard();
          model.body.form = items;
        },
        readOnly,
      ),
      toString: function () {
        return model.body.raw || '';
      },
      isEmpty: function () {
        return model.body.mode === 'None';
      },
    };

    var headers = PropertyList(
      function () {
        return model.headers;
      },
      function (items) {
        guard();
        model.headers = items;
      },
      readOnly,
    );

    return {
      get method() {
        return model.method;
      },
      set method(value) {
        guard();
        model.method = String(value).toUpperCase();
      },
      get url() {
        return url;
      },
      set url(value) {
        guard();
        model.url = String(value);
      },
      headers: headers,
      body: body,
      auth: model.auth || null,
      addHeader: function (item, value) {
        headers.add(item, value);
      },
      removeHeader: function (key) {
        headers.remove(key);
      },
      upsertHeader: function (item, value) {
        headers.upsert(item, value);
      },
      toJSON: function () {
        return { method: model.method, url: model.url, header: model.headers, body: model.body };
      },
    };
  }

