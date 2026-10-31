import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Koşullu Tailwind sınıflarını birleştirir, çakışanlarda sonuncusu kazanır. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
