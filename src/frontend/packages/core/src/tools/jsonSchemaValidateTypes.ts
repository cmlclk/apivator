/** `jsonSchemaValidate` için tür bildirimleri (dışarıya `jsonSchemaValidate.ts` üzerinden yeniden dışa aktarılır). */

export type ValidateDraft = 'auto' | '2020-12' | '07';

export interface ValidateOptions {
  /** Şema sürümü; `auto` ise `$schema`'dan (yoksa 2020-12). */
  draft?: ValidateDraft;
  /** `format` uyumsuzlukları da hata sayılsın. */
  assertFormats?: boolean;
  /** En fazla bu kadar hata raporlanır (varsayılan 100). */
  maxErrors?: number;
  /** OpenAPI belgesinde doğrulanacak şema; yoksa ilki. */
  schemaName?: string;
}

export interface SchemaValidationError {
  /** Verideki konum (JSON pointer; kök için ''). */
  instancePath: string;
  /** Şemadaki kural (ör. `#/properties/ad/type`). */
  schemaPath: string;
  keyword: string;
  message: string;
}

export interface SchemaValidationResult {
  valid: boolean;
  errors: SchemaValidationError[];
  /** Hata sayısı sınırı aşıldı; gösterilenden fazla hata var. */
  truncated: boolean;
  draft: '2020-12' | '07';
  /** Kısmen desteklenen kurallar hakkında notlar. */
  notes: string[];
}
