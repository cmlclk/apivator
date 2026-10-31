import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';
import { initI18n, loadNamespace } from '../i18n';

// Testler varsayılan olarak Türkçe çalışır (jsdom tarayıcı dili en-US). Araçların tembel ad alanları da baştan
// yüklenir; böylece testler ilk çizimde Suspense beklemez (setLanguage açık ad alanlarını yeni dilde de yükler).
await initI18n('tr');
await Promise.all(
  (['tools', 'toolsData', 'toolsSecurity', 'toolsMisc'] as const).map((ns) => loadNamespace('tr', ns)),
);

// Node 24'ün Request'i (undici) jsdom'un AbortSignal'ını kabul etmiyor; react-router her gezinmede sinyalli
// Request kurduğu için gezinme testleri hata veriyordu. Request sinyalsiz kurulur, jsdom sinyali `signal`
// olarak gösterilir (react-router yalnızca `aborted` ve `abort` olayına bakar).
const NodeRequest = globalThis.Request;
class JsdomSignalRequest extends NodeRequest {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    const { signal, ...rest } = init ?? {};
    super(input, rest);
    if (signal) Object.defineProperty(this, 'signal', { value: signal });
  }
}
globalThis.Request = JsdomSignalRequest;

// findBy*/waitFor varsayılanı 1 sn; tüm paket paralel koşarken tembel yüklenen modüller (kod editörü,
// model üretici) bunu aşabiliyor. Başarılı beklemeler yine ilk eşleşmede biter.
configure({ asyncUtilTimeout: 5000 });

afterEach(() => cleanup());
