import type { GeneratedFile, ModelLanguage } from '@apivator/core/models';
import type { RawLanguage } from '@apivator/core';
import { safeFileName, saveFile } from '../../lib/download';

/** Üretilen kodun editördeki vurgulama dili; listede olmayanlar düz metin. */
export const MODEL_EDITOR_LANGUAGE: Partial<Record<ModelLanguage, RawLanguage>> = {
  typescript: 'JavaScript',
  jsonschema: 'Json',
};

/** Yapıştırılan şema: JSON, değilse YAML (OpenAPI belgeleri çoğunlukla YAML). */
export async function parseSchemaText(text: string): Promise<unknown> {
  try {
    return JSON.parse(text);
  } catch {
    const { parse } = await import('yaml');
    return parse(text) as unknown;
  }
}

/** Tek dosya olduğu gibi, birden çok dosya ZIP olarak indirilir. */
export async function downloadModelFiles(files: GeneratedFile[], rootName: string): Promise<void> {
  if (!files.length) return;
  if (files.length === 1) {
    await saveFile({
      blob: new Blob([files[0]!.content], { type: 'text/plain;charset=utf-8' }),
      fileName: files[0]!.name,
    });
    return;
  }
  const encoder = new TextEncoder();
  // ZIP yazıcı (Excel dışa aktarmayla ortak) yalnızca gerekince yüklenir.
  const { createZip } = await import('@apivator/core/tableExport');
  const zip = await createZip(files.map((f) => ({ name: f.name, data: encoder.encode(f.content) })));
  await saveFile({
    blob: new Blob([zip as BlobPart], { type: 'application/zip' }),
    fileName: `${safeFileName(rootName, 'model')}.zip`,
  });
}
