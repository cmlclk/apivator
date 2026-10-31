import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { translate, type MessageKey } from '../../i18n';

type Members = Record<string, Completion[]>;
type Key = MessageKey<'scripts'>;

/** Öneri metinleri çağrı anında çevrilir (modül yüklenirken dil henüz seçilmemiş olabilir). */
const c = (key: Key, params?: Record<string, string>) => translate('scripts', key, params);

const fn = (label: string, detail: string, info?: string): Completion => ({
  label,
  type: 'function',
  detail,
  info,
  apply: `${label}()`,
});
const prop = (label: string, detail: string, info?: string): Completion => ({
  label,
  type: 'property',
  detail,
  info,
});

const scopeMembers = (scope: string): Completion[] => [
  fn('get', c('completions.sig.key'), c('completions.info.scopeGet', { scope })),
  fn('set', c('completions.sig.keyValue'), c('completions.info.scopeSet', { scope })),
  fn('unset', c('completions.sig.key'), c('completions.info.scopeUnset', { scope })),
  fn('has', c('completions.sig.key')),
  fn('toObject', '()', c('completions.info.toObject')),
  fn('replaceIn', c('completions.sig.text'), c('completions.info.replaceIn')),
  fn('clear', '()'),
];

const listMembers = (): Completion[] => [
  fn('get', c('completions.sig.key')),
  fn('has', c('completions.sig.keyValueOpt')),
  fn('add', '({ key, value })'),
  fn('upsert', '({ key, value })'),
  fn('remove', c('completions.sig.key')),
  fn('toObject', '()'),
  fn('each', '(fn)'),
  fn('all', '()'),
  fn('count', '()'),
];

/** Nesne yolu → üyeleri. Yol, imleçten önceki "pm.response." gibi ifadeden çıkarılır. */
export function pmMembers(): Members {
  const vars = c('completions.kind.variables');
  const assertion = c('completions.kind.assertion');
  const list = c('completions.kind.list');
  const cookies = c('completions.kind.cookies');
  const body = c('completions.kind.body');
  return {
    pm: [
      fn('test', c('completions.sig.nameFn'), c('completions.info.test')),
      fn('expect', c('completions.sig.value'), c('completions.info.expect')),
      prop('response', c('completions.kind.response'), c('completions.info.responseOnly')),
      prop('request', c('completions.kind.request'), c('completions.info.requestEditable')),
      prop('environment', vars, c('completions.info.activeEnvironment')),
      prop('collectionVariables', vars),
      prop('globals', vars),
      prop('variables', vars, c('completions.info.allScopes')),
      prop('iterationData', vars, c('completions.info.iterationData')),
      prop('info', c('completions.kind.info'), 'eventName, requestName, iteration...'),
      prop('execution', c('completions.kind.flow'), 'setNextRequest, skipRequest'),
      fn('sendRequest', c('completions.sig.sendRequest'), c('completions.info.sendRequest')),
      prop('cookies', cookies, c('completions.info.setCookie')),
    ],
    'pm.response': [
      prop('code', 'number'),
      prop('status', 'string'),
      prop('responseTime', 'ms'),
      prop('responseSize', c('completions.kind.bytes')),
      prop('headers', list),
      prop('to', assertion, 'pm.response.to.have.status(200)'),
      fn('json', '()', c('completions.info.json')),
      fn('text', '()'),
      fn('size', '()', c('completions.info.size')),
      fn('reason', '()', c('completions.info.reason')),
      prop('cookies', cookies),
    ],
    'pm.response.to': [
      prop('have', assertion),
      prop('be', assertion),
      prop('not', c('completions.kind.negation')),
    ],
    'pm.response.to.have': [
      fn('status', c('completions.sig.codeOrText')),
      fn('header', c('completions.sig.nameValueOpt')),
      fn('body', c('completions.sig.bodyArg')),
      fn('jsonBody', c('completions.sig.pathValueOpt')),
      fn('jsonSchema', c('completions.sig.schema'), c('completions.info.jsonSchema')),
    ],
    'pm.response.to.be': [
      prop('ok', '2xx'),
      prop('success', '2xx'),
      prop('json', 'Content-Type JSON'),
      prop('error', '4xx/5xx'),
      prop('clientError', '4xx'),
      prop('serverError', '5xx'),
      prop('notFound', '404'),
      prop('unauthorized', '401'),
      prop('forbidden', '403'),
      prop('badRequest', '400'),
      prop('accepted', '202'),
      prop('rateLimited', '429'),
      prop('withBody', c('completions.kind.hasBody')),
      prop('html', 'Content-Type HTML'),
      prop('xml', 'Content-Type XML'),
    ],
    'pm.response.headers': listMembers(),
    'pm.cookies': [
      fn('get', c('completions.sig.name')),
      fn('has', c('completions.sig.name')),
      fn('toObject', '()'),
    ],
    'pm.request': [
      prop('url', 'URL'),
      prop('method', 'string'),
      prop('headers', list),
      prop('body', body),
      fn('addHeader', '({ key, value })'),
      fn('removeHeader', c('completions.sig.name')),
      fn('upsertHeader', '({ key, value })'),
    ],
    'pm.request.headers': listMembers(),
    'pm.request.url': [
      fn('toString', '()'),
      fn('update', '(url)'),
      fn('getHost', '()'),
      fn('getPath', '()'),
      prop('query', list),
    ],
    'pm.request.url.query': listMembers(),
    'pm.request.body': [
      prop('raw', 'string'),
      prop('mode', 'string'),
      fn('update', c('completions.sig.text')),
    ],
    'pm.environment': [...scopeMembers('Environment'), prop('name', 'string')],
    'pm.collectionVariables': scopeMembers('Collection'),
    'pm.globals': scopeMembers('Global'),
    'pm.variables': scopeMembers(c('completions.scopeLocal')),
    'pm.iterationData': [
      fn('get', c('completions.sig.key')),
      fn('has', c('completions.sig.key')),
      fn('toObject', '()'),
    ],
    'pm.info': [
      prop('eventName', 'prerequest | test'),
      prop('requestName', 'string'),
      prop('requestId', 'string'),
      prop('iteration', 'number'),
      prop('iterationCount', 'number'),
    ],
    'pm.execution': [
      fn('setNextRequest', c('completions.sig.nameOrNull'), c('completions.info.setNextRequest')),
      fn('skipRequest', '()', c('completions.info.skipRequest')),
    ],
    console: [fn('log', '(...)'), fn('info', '(...)'), fn('warn', '(...)'), fn('error', '(...)')],
  };
}

const globals = (): Completion[] => [
  { label: 'pm', type: 'variable', detail: 'Postman API' },
  { label: 'console', type: 'variable' },
  { label: 'CryptoJS', type: 'variable', detail: 'crypto-js' },
  { label: '_', type: 'variable', detail: 'lodash' },
  fn('atob', '(base64)'),
  fn('btoa', c('completions.sig.text')),
  { label: 'moment', type: 'variable', detail: 'moment', info: c('completions.info.moment') },
  { label: 'tv4', type: 'variable', detail: 'JSON Schema (draft-04)' },
  fn('xml2Json', '(xml)', c('completions.info.xml2Json')),
  fn('require', "('chai' | 'lodash' | 'crypto-js' | 'moment' | 'tv4' | 'uuid')"),
];

/** `pm.` ile başlayan ifadeler için öneriler. */
export function pmCompletionSource(context: CompletionContext): CompletionResult | null {
  const word = context.matchBefore(/[\w$.]*$/);
  if (!word || (word.from === word.to && !context.explicit)) return null;
  const text = word.text;
  const dot = text.lastIndexOf('.');
  if (dot < 0) {
    return { from: word.from, options: globals(), validFor: /^[\w$]*$/ };
  }
  const path = text.slice(0, dot);
  const options = pmMembers()[path];
  if (!options) return null;
  return { from: word.from + dot + 1, options, validFor: /^[\w$]*$/ };
}
