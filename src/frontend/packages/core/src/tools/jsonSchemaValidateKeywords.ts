/** Tek veri konumundaki sayı/metin/dizi/nesne boyut kuralları; hata bildirimi `err` ile yapılır. */
import { msg } from '../i18n';
import { codePointLength, isMultipleOf } from './jsonSchemaValidateHelpers';
import { checkFormat } from './jsonSchemaFormats';

type Schema = Record<string, unknown>;
export type ErrFn = (keyword: string, message: () => string) => void;

export function checkNumber(schema: Schema, value: number, err: ErrFn) {
  const { minimum, maximum, exclusiveMinimum: exMin, exclusiveMaximum: exMax, multipleOf } = schema;
  // Draft-04 tarzı boolean exclusive* de desteklenir.
  if (typeof minimum === 'number') {
    if (exMin === true ? value <= minimum : value < minimum)
      err('minimum', () =>
        exMin === true
          ? msg('toolsData.validate.greaterThan', '{limit} değerinden büyük olmalı.', {
              limit: String(minimum),
            })
          : msg('toolsData.validate.atLeast', 'En az {limit} olmalı.', { limit: String(minimum) }),
      );
  }
  if (typeof maximum === 'number') {
    if (exMax === true ? value >= maximum : value > maximum)
      err('maximum', () =>
        exMax === true
          ? msg('toolsData.validate.lessThan', '{limit} değerinden küçük olmalı.', { limit: String(maximum) })
          : msg('toolsData.validate.atMost', 'En fazla {limit} olmalı.', { limit: String(maximum) }),
      );
  }
  if (typeof exMin === 'number' && value <= exMin)
    err('exclusiveMinimum', () =>
      msg('toolsData.validate.greaterThan', '{limit} değerinden büyük olmalı.', { limit: String(exMin) }),
    );
  if (typeof exMax === 'number' && value >= exMax)
    err('exclusiveMaximum', () =>
      msg('toolsData.validate.lessThan', '{limit} değerinden küçük olmalı.', { limit: String(exMax) }),
    );
  if (typeof multipleOf === 'number' && !isMultipleOf(value, multipleOf))
    err('multipleOf', () =>
      msg('toolsData.validate.multipleOf', '{factor} değerinin katı olmalı.', { factor: String(multipleOf) }),
    );
}

/** `minLength` / `maxLength` / `pattern` / `format`; `regex` desen derlemesini (önbellekli) yapar. */
export function checkString(
  schema: Schema,
  inst: string,
  err: ErrFn,
  regex: (pattern: string) => RegExp,
  assertFormats: boolean,
) {
  // $ref (ve statik çözülen $dynamicRef / $recursiveRef)
  const length =
    typeof schema.minLength === 'number' || typeof schema.maxLength === 'number' ? codePointLength(inst) : 0;
  if (typeof schema.minLength === 'number' && length < schema.minLength)
    err('minLength', () =>
      msg('toolsData.validate.minLength', 'En az {min} karakter olmalı ({count} var).', {
        min: String(schema.minLength),
        count: String(length),
      }),
    );
  if (typeof schema.maxLength === 'number' && length > schema.maxLength)
    err('maxLength', () =>
      msg('toolsData.validate.maxLength', 'En fazla {max} karakter olmalı ({count} var).', {
        max: String(schema.maxLength),
        count: String(length),
      }),
    );
  if (typeof schema.pattern === 'string' && !regex(schema.pattern).test(inst))
    err('pattern', () =>
      msg('toolsData.validate.pattern', 'Desene uymuyor: {pattern}', { pattern: String(schema.pattern) }),
    );
  if (assertFormats && typeof schema.format === 'string' && !checkFormat(schema.format, inst))
    err('format', () =>
      msg('toolsData.validate.format', '"{format}" biçimine uymuyor.', { format: String(schema.format) }),
    );
}

/** `minItems` / `maxItems`. */
export function checkArraySize(schema: Schema, inst: unknown[], err: ErrFn) {
  if (typeof schema.minItems === 'number' && inst.length < schema.minItems)
    err('minItems', () =>
      msg('toolsData.validate.minItems', 'En az {min} öğe olmalı ({count} var).', {
        min: String(schema.minItems),
        count: String(inst.length),
      }),
    );
  if (typeof schema.maxItems === 'number' && inst.length > schema.maxItems)
    err('maxItems', () =>
      msg('toolsData.validate.maxItems', 'En fazla {max} öğe olmalı ({count} var).', {
        max: String(schema.maxItems),
        count: String(inst.length),
      }),
    );
}

/** `minProperties` / `maxProperties`. */
export function checkObjectSize(schema: Schema, keys: string[], err: ErrFn) {
  if (typeof schema.minProperties === 'number' && keys.length < schema.minProperties)
    err('minProperties', () =>
      msg('toolsData.validate.minProperties', 'En az {min} alan olmalı ({count} var).', {
        min: String(schema.minProperties),
        count: String(keys.length),
      }),
    );
  if (typeof schema.maxProperties === 'number' && keys.length > schema.maxProperties)
    err('maxProperties', () =>
      msg('toolsData.validate.maxProperties', 'En fazla {max} alan olmalı ({count} var).', {
        max: String(schema.maxProperties),
        count: String(keys.length),
      }),
    );
}
