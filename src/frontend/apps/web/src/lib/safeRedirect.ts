/** Ters eğik çizgi ve denetim karakterleri tarayıcıda "/" gibi yorumlanabilir. */
function hasUnsafeChars(value: string): boolean {
  return [...value].some((c) => c === '\\' || c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
}

/** Açık yönlendirme (open redirect) açığını önlemek için yalnızca uygulama içi yollara izin verir. */
export function safeRedirect(value: string | null): string {
  return value && value.startsWith('/') && !value.startsWith('//') && !hasUnsafeChars(value) ? value : '/';
}
