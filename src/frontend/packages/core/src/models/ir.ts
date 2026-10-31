/**
 * Model üretiminin ara temsili: JSON örneklerinden, JSON Schema / OpenAPI'den ya da gRPC mesajından çıkarılır,
 * dil üreticileri bunu koda çevirir.
 */

/** `number` ondalık; üreticiler seçeneğe göre double ya da decimal yazar. */
export type PrimitiveType =
  'string' | 'integer' | 'long' | 'number' | 'boolean' | 'date' | 'datetime' | 'uuid' | 'any';

export type TypeRef =
  | { kind: 'primitive'; type: PrimitiveType }
  | { kind: 'array'; items: TypeRef }
  | { kind: 'map'; values: TypeRef }
  | { kind: 'class'; name: string }
  | { kind: 'enum'; name: string };

export interface ModelField {
  /** JSON'daki ad (olduğu gibi). */
  name: string;
  type: TypeRef;
  /** Değer `null` olabilir. */
  nullable: boolean;
  /** Alan bazı örneklerde yok ya da şemada zorunlu değil. */
  optional: boolean;
  description?: string;
}

export interface ModelClass {
  kind: 'class';
  name: string;
  fields: ModelField[];
  description?: string;
}

export interface ModelEnum {
  kind: 'enum';
  name: string;
  values: string[];
  description?: string;
}

export type ModelType = ModelClass | ModelEnum;

export interface ModelSet {
  /** Kökün tipi (ör. kök dizi için `array` → sınıf). */
  root: TypeRef;
  rootNullable?: boolean;
  /** Bağımlılık sırasıyla: önce kök, sonra kullandıkları. */
  types: ModelType[];
}

export const primitive = (type: PrimitiveType): TypeRef => ({ kind: 'primitive', type });

/** Bir tipte geçen sınıf/enum adları. */
export function referencedNames(type: TypeRef): string[] {
  switch (type.kind) {
    case 'array':
      return referencedNames(type.items);
    case 'map':
      return referencedNames(type.values);
    case 'class':
    case 'enum':
      return [type.name];
    default:
      return [];
  }
}

/** Tipte `any` var mı (yardımcı tür gerektiren diller için). */
export function usesPrimitive(set: ModelSet, wanted: PrimitiveType): boolean {
  const visit = (t: TypeRef): boolean =>
    t.kind === 'primitive'
      ? t.type === wanted
      : t.kind === 'array'
        ? visit(t.items)
        : t.kind === 'map'
          ? visit(t.values)
          : false;
  return visit(set.root) || set.types.some((t) => t.kind === 'class' && t.fields.some((f) => visit(f.type)));
}
