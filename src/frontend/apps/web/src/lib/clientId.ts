/** Bu sekmenin (pencerenin) kimliği. Sunucu, değişikliği yapan sekmeyi olaylarda geri bildirir. */
export const clientId =
  globalThis.crypto?.randomUUID?.() ?? `c-${Date.now()}-${Math.random().toString(16).slice(2)}`;
