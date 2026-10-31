import { describe, expect, it } from 'vitest';
import contract from '../../../../shared/dynamic-variables.json';
import { ibanValid, luhnValid, tcknValid } from './tools/fakeDataChecks';
import { FAKE_DYNAMIC_VARIABLES } from './tools/fakeData';
import { FAKE_DATA_TR } from './tools/fakeDataTr';
import { isDynamicVariable, resolveText } from './variables';

/**
 * Ortak sözleşme (src/shared/dynamic-variables.json): sunucu (VariableResolver) ve script sandbox'ı da aynı
 * dosyaya karşı test edilir. Bir tarafta eklenen ad öbürlerinde yoksa testler kırılır.
 */
interface Rule {
  name: string;
  pattern: string;
  check?: 'tckn' | 'iban' | 'luhn';
  int?: [number, number];
  number?: [number, number];
  domains?: string[];
  secondsFromNow?: [number, number];
}

const rules = contract.variables as Rule[];
const SAMPLES = 200;

const CHECKS: Record<NonNullable<Rule['check']>, (value: string) => boolean> = {
  tckn: tcknValid,
  iban: ibanValid,
  luhn: luhnValid,
};

function violation(rule: Rule, value: string, nowMs: number): string | undefined {
  if (!new RegExp(rule.pattern).test(value)) return 'biçim';
  if (rule.check && !CHECKS[rule.check](value)) return rule.check;
  const n = Number(value);
  if (rule.int && !(Number.isInteger(n) && n >= rule.int[0] && n <= rule.int[1])) return 'aralık';
  if (rule.number && !(n >= rule.number[0] && n <= rule.number[1])) return 'aralık';
  if (rule.domains) {
    const host = value.includes('@') ? value.split('@')[1]! : new URL(value).hostname;
    if (!rule.domains.some((d) => host === d || host.endsWith('.' + d))) return 'alan adı';
  }
  if (rule.secondsFromNow) {
    const ms = /^[0-9]+$/.test(value) ? n * 1000 : Date.parse(value);
    const offset = (ms - nowMs) / 1000;
    if (!(offset >= rule.secondsFromNow[0] && offset <= rule.secondsFromNow[1])) return 'zaman';
  }
  return undefined;
}

describe('dinamik değişken sözleşmesi', () => {
  it('istemcinin ad listesi sözleşmeyle aynı', () => {
    const client = ['$timestamp', '$isoTimestamp', ...Object.keys(FAKE_DYNAMIC_VARIABLES)].sort();
    expect(client).toEqual(rules.map((r) => r.name).sort());
    for (const rule of rules) expect(isDynamicVariable(rule.name)).toBe(true);
  });

  it.each(rules.map((r) => [r.name, r] as const))('%s biçimi ve aralığı', (_, rule) => {
    const map = new Map();
    for (let i = 0; i < SAMPLES; i++) {
      const now = Date.now();
      const value = resolveText(`{{${rule.name}}}`, map).text;
      const problem = violation(rule, value, now);
      expect(problem ? `${problem}: ${value}` : undefined).toBeUndefined();
    }
  });

  it('bilinmeyen adlar çözülmeden kalır', () => {
    for (const name of contract.unresolved) {
      const result = resolveText(`{{${name}}}`, new Map());
      expect(result.text).toBe(`{{${name}}}`);
      expect(result.unresolved.has(name)).toBe(true);
    }
  });
});

/** Sunucudaki veri kümesi fakeDataTr.ts'ten kopyalanır; listeler birebir aynı kalmalı. */
const SERVER_DATA = '../../../../backend/src/Apivator.Application/Execution/DynamicValuesData.cs?raw';

describe('sunucu veri kümesi (DynamicValuesData.cs)', () => {
  it('fakeDataTr.ts ile birebir aynı', async () => {
    // Değişken yol: tür denetimi `?raw` bildirimine ihtiyaç duymaz; Vitest dosyayı metin olarak verir.
    const source: string = (await import(/* @vite-ignore */ SERVER_DATA)).default;
    const strings = (text: string) => [...text.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
    const array = (name: string) => {
      const body = new RegExp(`string\\[\\] ${name} =\\s*\\[([\\s\\S]*?)\\];`).exec(source)?.[1];
      return body === undefined ? undefined : strings(body);
    };
    const { cities, ...lists } = FAKE_DATA_TR;
    for (const [key, values] of Object.entries(lists)) {
      expect(array(key.charAt(0).toUpperCase() + key.slice(1)), key).toEqual(values);
    }
    const serverCities = [...source.matchAll(/new\("([^"]+)", "([0-9]+)", \[([^\]]*)\]\)/g)].map((m) => ({
      name: m[1],
      districts: strings(m[3]!),
      postalPrefix: m[2],
    }));
    expect(serverCities).toEqual(cities);
  });
});
