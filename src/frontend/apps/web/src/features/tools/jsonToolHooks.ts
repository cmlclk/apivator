import { useEffect, useState } from 'react';

/** Bu boyutun üstündeki girdiler her tuşta değil, yazma durunca işlenir. */
const LARGE_INPUT = 100_000;

/** Büyük metinlerde değeri gecikmeli döndürür (her tuşta yeniden çözümlenmesin); küçük metinlerde hemen. */
export function useDebouncedText(value: string, delay = 400): string {
  const [debounced, setDebounced] = useState(value);
  const immediate = value.length < LARGE_INPUT;
  useEffect(() => {
    if (immediate) return;
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, immediate, delay]);
  return immediate ? value : debounced;
}
