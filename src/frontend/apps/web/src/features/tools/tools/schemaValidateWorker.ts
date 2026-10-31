/**
 * JSON Schema doğrulama işi. Şemadaki `pattern` / `patternProperties` ifadeleri felaket geri izleme yapabilir;
 * sekme donmasın diye Worker'da çalışır, Worker yoksa (test ortamı) aynı fonksiyon ana iş parçacığında çağrılır.
 */
import { validateJsonSchema, type SchemaValidationResult, type ValidateOptions } from '@apivator/core/tools';

export interface SchemaValidateJob {
  /** Ayrıştırılmış şema ya da OpenAPI belgesi. */
  doc: unknown;
  data: unknown;
  options: ValidateOptions;
}

export type SchemaValidateRequest = SchemaValidateJob & { id: number };

export type SchemaValidateResponse =
  | { id: number; type: 'result'; result: SchemaValidationResult }
  | { id: number; type: 'error'; error: string };

/** Doğrulamayı yapar; hiçbir zaman fırlatmaz (ör. harici `$ref` hatası yanıt olarak döner). */
export function runSchemaValidate({ id, doc, data, options }: SchemaValidateRequest): SchemaValidateResponse {
  try {
    return { id, type: 'result', result: validateJsonSchema(doc, data, options) };
  } catch (e) {
    return { id, type: 'error', error: e instanceof Error ? e.message : String(e) };
  }
}

// Worker içinde çalışırken mesajları dinle (ana iş parçacığında içe aktarılınca bir şey yapmaz).
if (typeof window === 'undefined' && typeof self !== 'undefined' && 'postMessage' in self) {
  self.onmessage = (event: MessageEvent<SchemaValidateRequest>) => {
    self.postMessage(runSchemaValidate(event.data));
  };
}
