import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

interface JsonSchema {
  $schema?: string;
  $id?: string;
  $defs?: Record<string, JsonSchema>;
  $ref?: string;
  title?: string;
  description?: string;
  type?: string | string[];
  const?: unknown;
  enum?: unknown[];
  pattern?: string;
  minLength?: number;
  minimum?: number;
  minItems?: number;
  required?: string[];
  properties?: Record<string, JsonSchema>;
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema;
  oneOf?: JsonSchema[];
}

function matchesType(value: unknown, expected: string): boolean {
  if (expected === 'null') return value === null;
  if (expected === 'array') return Array.isArray(value);
  if (expected === 'object') return typeof value === 'object' && value !== null && !Array.isArray(value);
  if (expected === 'integer') return typeof value === 'number' && Number.isInteger(value);
  if (expected === 'number') return typeof value === 'number' && !Number.isNaN(value);
  if (expected === 'string') return typeof value === 'string';
  if (expected === 'boolean') return typeof value === 'boolean';
  return false;
}

function resolveRef(ref: string, root: JsonSchema): JsonSchema {
  if (!ref.startsWith('#/$defs/')) {
    throw new Error(`Unsupported $ref: ${ref}`);
  }
  const key = ref.slice('#/$defs/'.length);
  const target = root.$defs?.[key];
  if (!target) throw new Error(`Unresolved $ref: ${ref}`);
  return target;
}

function validateSchema(value: unknown, schema: JsonSchema, root: JsonSchema, at = '$'): string[] {
  if (schema.$ref) {
    return validateSchema(value, resolveRef(schema.$ref, root), root, at);
  }

  if (schema.oneOf) {
    const branchErrors = schema.oneOf.map((sub) => validateSchema(value, sub, root, at));
    const passing = branchErrors.filter((errs) => errs.length === 0).length;
    if (passing === 1) return [];
    if (passing === 0) {
      return [`${at}: matched 0 oneOf branches (${branchErrors[0]?.[0] ?? 'no match'})`];
    }
    return [`${at}: matched ${passing} oneOf branches (expected exactly 1)`];
  }

  if (schema.type !== undefined) {
    const allowed = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!allowed.some((t) => matchesType(value, t))) {
      return [`${at}: expected type ${allowed.join('|')}, got ${value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value}`];
    }
  }

  if (schema.const !== undefined && value !== schema.const) {
    return [`${at}: expected const ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`];
  }

  if (schema.enum && !schema.enum.includes(value)) {
    return [`${at}: expected enum member, got ${JSON.stringify(value)}`];
  }

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      return [`${at}: string length ${value.length} < minLength ${schema.minLength}`];
    }
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) {
      return [`${at}: string ${JSON.stringify(value)} failed pattern ${schema.pattern}`];
    }
  }

  if (typeof value === 'number' && schema.minimum !== undefined && value < schema.minimum) {
    return [`${at}: number ${value} < minimum ${schema.minimum}`];
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      return [`${at}: array length ${value.length} < minItems ${schema.minItems}`];
    }
    if (schema.items) {
      for (let i = 0; i < value.length; i += 1) {
        const errs = validateSchema(value[i], schema.items, root, `${at}[${i}]`);
        if (errs.length > 0) return errs;
      }
    }
  }

  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    for (const reqKey of schema.required ?? []) {
      if (!(reqKey in record)) {
        return [`${at}: missing required property "${reqKey}"`];
      }
    }
    const props = schema.properties ?? {};
    for (const [k, v] of Object.entries(record)) {
      if (k in props) {
        const errs = validateSchema(v, props[k], root, `${at}.${k}`);
        if (errs.length > 0) return errs;
      } else if (schema.additionalProperties === false) {
        return [`${at}: unexpected additional property "${k}"`];
      } else if (typeof schema.additionalProperties === 'object' && schema.additionalProperties !== null) {
        const errs = validateSchema(v, schema.additionalProperties, root, `${at}.${k}`);
        if (errs.length > 0) return errs;
      }
    }
  }

  return [];
}

function loadJson<T = unknown>(...segments: string[]): T {
  return JSON.parse(fs.readFileSync(path.join(process.cwd(), ...segments), 'utf8')) as T;
}

describe('JSON Data Contracts (docs/schemas/*.schema.json)', () => {
  const packagesSchema = loadJson<JsonSchema>('docs', 'schemas', 'packages.schema.json');
  const collectionSchema = loadJson<JsonSchema>('docs', 'schemas', 'collection-shard.schema.json');
  const rulesSchema = loadJson<JsonSchema>('docs', 'schemas', 'rules.schema.json');
  const effectSchema = loadJson<JsonSchema>('docs', 'schemas', 'effect-shard.schema.json');

  it('validates data/packages.json against packages.schema.json', () => {
    const packages = loadJson('data', 'packages.json');
    expect(validateSchema(packages, packagesSchema, packagesSchema)).toEqual([]);
  });

  it('validates data/rules.json against rules.schema.json', () => {
    const rules = loadJson('data', 'rules.json');
    expect(validateSchema(rules, rulesSchema, rulesSchema)).toEqual([]);
  });

  it('validates all 26 collection shards under data/collections/*.json against collection-shard.schema.json', () => {
    const dir = path.join(process.cwd(), 'data', 'collections');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
    expect(files.length).toBeGreaterThanOrEqual(26);

    for (const file of files) {
      const payload = loadJson('data', 'collections', file);
      const errs = validateSchema(payload, collectionSchema, collectionSchema, file);
      expect(errs, `${file} failed schema validation`).toEqual([]);
    }
  });

  it('validates all 28 Effect Shards under data/effects/*.json against effect-shard.schema.json', () => {
    const dir = path.join(process.cwd(), 'data', 'effects');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
    expect(files.length).toBeGreaterThanOrEqual(28);

    for (const file of files) {
      const payload = loadJson('data', 'effects', file);
      const errs = validateSchema(payload, effectSchema, effectSchema, file);
      expect(errs, `${file} failed schema validation`).toEqual([]);
    }
  });

  it('rejects malformed payloads and unknown union discriminators (negative contract checks)', () => {
    const sampleEffect = loadJson<Record<string, unknown>>('data', 'effects', 'ST09.json');

    // Wrong schemaVersion
    expect(validateSchema({ ...sampleEffect, schemaVersion: 1 }, effectSchema, effectSchema).length).toBeGreaterThan(0);
    expect(validateSchema({ ...sampleEffect, schemaVersion: 99 }, effectSchema, effectSchema).length).toBeGreaterThan(0);

    // Unexpected top-level key
    expect(validateSchema({ ...sampleEffect, extraField: true }, effectSchema, effectSchema).length).toBeGreaterThan(0);

    // Invalid EffectStep action discriminator
    const badStep = structuredClone(sampleEffect) as {
      effects: Record<string, { abilities: Record<string, unknown>[] }>;
    };
    (badStep.effects['ST09-001'].abilities[0].steps as unknown[])[0] = { action: 'UNKNOWN_STEP' };
    expect(validateSchema(badStep, effectSchema, effectSchema).length).toBeGreaterThan(0);

    // Invalid EffectCondition kind discriminator
    const badCondition = structuredClone(sampleEffect) as {
      effects: Record<string, { abilities: Record<string, unknown>[] }>;
    };
    badCondition.effects['ST09-006'].abilities[0].condition = { kind: 'BOGUS_CONDITION' };
    expect(validateSchema(badCondition, effectSchema, effectSchema).length).toBeGreaterThan(0);

    // Removed STATIC_PERMISSION modifier must be rejected
    const badModifier = structuredClone(sampleEffect) as {
      effects: Record<string, { abilities: Record<string, unknown>[] }>;
    };
    badModifier.effects['ST09-001'].abilities[0] = {
      kind: 'CONTINUOUS_MODIFIER',
      clauseIndex: 0,
      raw: 'test',
      layer: 2,
      activeIn: 'BATTLE_AREA',
      modifier: { type: 'STATIC_PERMISSION', summary: 'nope', target: { owner: 'SELF' } },
    };
    expect(validateSchema(badModifier, effectSchema, effectSchema).length).toBeGreaterThan(0);

    // Invalid RawCardPrint type in collection shard
    const sampleCol = loadJson<{ cards: Record<string, unknown>[] }>('data', 'collections', 'ST09.json');
    const badCol = structuredClone(sampleCol);
    badCol.cards[0].type = 'INVALID_TYPE';
    expect(validateSchema(badCol, collectionSchema, collectionSchema).length).toBeGreaterThan(0);
  });

  it('documents every $defs name, property key, const, and enum value from effect-shard.schema.json in docs/CARD_EFFECT_JSON_GUIDE.md', () => {
    const guide = fs.readFileSync(path.join(process.cwd(), 'docs', 'CARD_EFFECT_JSON_GUIDE.md'), 'utf8');
    const missing: string[] = [];

    for (const defName of Object.keys(effectSchema.$defs ?? {})) {
      if (!guide.includes(defName)) {
        missing.push(`$defs/${defName}`);
      }
    }

    const collectTokens = (node: JsonSchema | undefined) => {
      if (!node || typeof node !== 'object') return;
      if (typeof node.const === 'string' && !guide.includes(`"${node.const}"`) && !guide.includes(`\`${node.const}\``)) {
        missing.push(`const:${node.const}`);
      }
      if (Array.isArray(node.enum)) {
        for (const val of node.enum) {
          if (typeof val === 'string' && !guide.includes(`"${val}"`) && !guide.includes(`\`${val}\``)) {
            missing.push(`enum:${val}`);
          }
        }
      }
      if (node.properties) {
        for (const [propName, propSchema] of Object.entries(node.properties)) {
          if (!guide.includes(`\`${propName}\``) && !guide.includes(`"${propName}"`)) {
            missing.push(`prop:${propName}`);
          }
          collectTokens(propSchema);
        }
      }
      if (typeof node.additionalProperties === 'object' && node.additionalProperties !== null) {
        collectTokens(node.additionalProperties);
      }
      collectTokens(node.items);
      for (const branch of node.oneOf ?? []) {
        collectTokens(branch);
      }
    };

    collectTokens(effectSchema);
    for (const defSchema of Object.values(effectSchema.$defs ?? {})) {
      collectTokens(defSchema);
    }

    expect([...new Set(missing)]).toEqual([]);
  });
});
