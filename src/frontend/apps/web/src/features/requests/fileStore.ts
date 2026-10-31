import { create } from 'zustand';
import type { ExecuteFile, RequestBody } from '@apivator/core';

/**
 * Gönderilecek dosyalar yalnızca bu oturumda bellekte tutulur (Postman'deki gibi istek tanımında sadece
 * dosya adı saklanır). Sayfa yenilenince dosyaların yeniden seçilmesi gerekir.
 */
interface FileState {
  files: Record<string, File>;
  remember: (tabId: string, file: File) => void;
  forgetTab: (tabId: string) => void;
}

const key = (tabId: string, name: string) => `${tabId}\u0000${name}`;

export const useFiles = create<FileState>()((set) => ({
  files: {},
  remember: (tabId, file) => set((s) => ({ files: { ...s.files, [key(tabId, file.name)]: file } })),
  forgetTab: (tabId) =>
    set((s) => ({
      files: Object.fromEntries(Object.entries(s.files).filter(([k]) => !k.startsWith(`${tabId}\u0000`))),
    })),
}));

export function findFile(tabId: string, name: string | null | undefined): File | undefined {
  return name ? useFiles.getState().files[key(tabId, name)] : undefined;
}

export function useHasFile(tabId: string, name: string | null | undefined): boolean {
  return useFiles((s) => (name ? key(tabId, name) in s.files : false));
}

async function toBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/** Body'deki dosya alanları için içerikleri toplar; eksik dosyaların adlarını döner. */
export async function collectFiles(
  tabId: string,
  body: RequestBody,
): Promise<{ files: ExecuteFile[]; missing: string[]; tooLarge: boolean }> {
  const wanted: { index: number; name: string; label: string }[] = [];
  if (body.mode === 'FormData') {
    body.form.forEach((item, index) => {
      if (item.enabled && item.key && item.type === 'File')
        wanted.push({ index, name: item.value, label: item.key });
    });
  } else if (body.mode === 'Binary') {
    wanted.push({ index: -1, name: body.fileName ?? '', label: 'Binary body' });
  }

  const missing: string[] = [];
  const files: ExecuteFile[] = [];
  let total = 0;
  for (const want of wanted) {
    const file = findFile(tabId, want.name);
    if (!file) {
      missing.push(want.name ? `${want.label} (${want.name})` : want.label);
      continue;
    }
    total += file.size;
    files.push({
      index: want.index,
      fileName: file.name,
      contentType: file.type || null,
      contentBase64: total > MAX_UPLOAD_BYTES ? '' : await toBase64(file),
    });
  }
  return { files, missing, tooLarge: total > MAX_UPLOAD_BYTES };
}
