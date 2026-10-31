import {
  getNamedType,
  isEnumType,
  isInputObjectType,
  isListType,
  isNonNullType,
  isObjectType,
  isInterfaceType,
  isScalarType,
  isUnionType,
  type GraphQLField,
  type GraphQLInputType,
  type GraphQLSchema,
  type GraphQLType,
} from 'graphql';

export type OperationKind = 'query' | 'mutation' | 'subscription';

export function rootType(schema: GraphQLSchema, kind: OperationKind) {
  return kind === 'query'
    ? schema.getQueryType()
    : kind === 'mutation'
      ? schema.getMutationType()
      : schema.getSubscriptionType();
}

/** "GraphQL alanını sorguya ekle" için örnek değer (değişkenler JSON'una). */
export function sampleValue(type: GraphQLInputType, depth = 0): unknown {
  if (isNonNullType(type)) return sampleValue(type.ofType, depth);
  if (isListType(type)) return [sampleValue(type.ofType, depth)];
  if (isEnumType(type)) return type.getValues()[0]?.name ?? '';
  if (isInputObjectType(type)) {
    if (depth > 2) return {};
    const result: Record<string, unknown> = {};
    for (const field of Object.values(type.getFields())) {
      if (isNonNullType(field.type)) result[field.name] = sampleValue(field.type, depth + 1);
    }
    return result;
  }
  if (isScalarType(type)) {
    switch (type.name) {
      case 'Int':
        return 0;
      case 'Float':
        return 0.0;
      case 'Boolean':
        return false;
      default:
        return '';
    }
  }
  return null;
}

/** Bir tipin seçim kümesi: skaler/enum alanlar; nesne alanı yoksa __typename. Birlik tiplerinde __typename. */
function selection(type: GraphQLType, indent: string, depth: number): string {
  const named = getNamedType(type);
  if (!isObjectType(named) && !isInterfaceType(named)) {
    return isUnionType(named) ? ` {\n${indent}  __typename\n${indent}}` : '';
  }
  const fields = Object.values(named.getFields());
  const leaves = fields
    .filter((f) => {
      const t = getNamedType(f.type);
      return (isScalarType(t) || isEnumType(t)) && !f.args.some((a) => isNonNullType(a.type));
    })
    .slice(0, 12);
  const lines = leaves.map((f) => `${indent}  ${f.name}`);
  // Hiç skaler yoksa bir seviye nesne alanına in (ör. bağlantı tipleri: edges/node).
  if (lines.length === 0 && depth < 2) {
    for (const f of fields.slice(0, 3)) {
      if (f.args.some((a) => isNonNullType(a.type))) continue;
      lines.push(`${indent}  ${f.name}${selection(f.type, indent + '  ', depth + 1)}`);
    }
  }
  if (lines.length === 0) lines.push(`${indent}  __typename`);
  return ` {\n${lines.join('\n')}\n${indent}}`;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Kök alan için çalıştırılabilir örnek işlem: zorunlu argümanlar değişken olur, seçim kümesi skaler alanlardan
 * kurulur. Değişkenler için örnek değerler de döner.
 */
export function buildOperation(
  kind: OperationKind,
  field: GraphQLField<unknown, unknown>,
): { query: string; variables: Record<string, unknown> } {
  const required = field.args.filter((a) => isNonNullType(a.type) && a.defaultValue === undefined);
  const variables: Record<string, unknown> = {};
  for (const arg of required) variables[arg.name] = sampleValue(arg.type);
  const declarations = required.length
    ? `(${required.map((a) => `$${a.name}: ${String(a.type)}`).join(', ')})`
    : '';
  const args = required.length ? `(${required.map((a) => `${a.name}: $${a.name}`).join(', ')})` : '';
  const query = `${kind} ${capitalize(field.name)}${declarations} {\n  ${field.name}${args}${selection(field.type, '  ', 0)}\n}\n`;
  return { query, variables };
}

/** Tip imzasını okunur yazar: [Kullanici!]! gibi. */
export const typeLabel = (type: GraphQLType) => String(type);
