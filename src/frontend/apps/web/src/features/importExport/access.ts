import type { KeyValueItem } from '@apivator/core';

export interface AccessState {
  token: string;
  headers: { key: string; value: string }[];
}

export const emptyAccess: AccessState = { token: '', headers: [] };

/** Bearer token ve ek header'lar → istek header'ları (boş olanlar atlanır). */
export function accessHeaders(access: AccessState): KeyValueItem[] {
  const result: KeyValueItem[] = [];
  const token = access.token.trim();
  if (token) {
    result.push({
      key: 'Authorization',
      value: /^(bearer|basic)\s/i.test(token) ? token : `Bearer ${token}`,
      enabled: true,
    });
  }
  for (const h of access.headers) {
    if (h.key.trim()) result.push({ key: h.key.trim(), value: h.value, enabled: true });
  }
  return result;
}
