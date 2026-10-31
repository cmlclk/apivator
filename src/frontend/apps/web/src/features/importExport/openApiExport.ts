import type { DownloadedFile } from '@apivator/core';

/** Sunucunun ürettiği OpenAPI JSON'unu YAML'a çevirir (yaml kütüphanesi yalnızca gerektiğinde yüklenir). */
export async function openApiAsYaml(file: DownloadedFile): Promise<DownloadedFile> {
  const { stringify } = await import('yaml');
  const document: unknown = JSON.parse(await file.blob.text());
  const text = stringify(document, { lineWidth: 0, aliasDuplicateObjects: false });
  return {
    blob: new Blob([text], { type: 'application/yaml' }),
    fileName: file.fileName.replace(/\.json$/i, '') + '.yaml',
  };
}
