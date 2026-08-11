import { createHash } from 'node:crypto';

import Ajv2020 from 'ajv/dist/2020.js';
import { z } from 'zod';

const STABLE_KEY_PATTERN = '^[A-Za-z][A-Za-z0-9_-]*$';
const SCOPE_KEY_PATTERN = '^[a-z][a-z0-9-]*$';
const nonEmptyText = z.string().trim().min(1);
const stableKey = nonEmptyText.regex(new RegExp(STABLE_KEY_PATTERN));
const aliases = z.array(stableKey);

const valueStreamSchema = z.object({
  key: stableKey,
  name: nonEmptyText,
  perceiver: nonEmptyText,
  order: z.number().int().positive(),
  aliases: aliases.optional(),
}).strict();

const capabilitySchema = z.object({
  key: stableKey,
  name: nonEmptyText,
  value_stream_key: stableKey,
  order: z.number().int().positive(),
  aliases: aliases.optional(),
}).strict();

const boundarySchema = z.object({
  key: stableKey,
  from: stableKey,
  to: stableKey,
  statement: nonEmptyText,
}).strict();

const crosscutSchema = z.object({
  key: stableKey,
  name: nonEmptyText,
  aliases: aliases.optional(),
  owner: stableKey.optional(),
  serves: z.array(stableKey).min(1),
}).strict();

const prerequisiteSchema = z.object({
  key: stableKey,
  name: nonEmptyText,
  aliases: aliases.optional(),
  serves: z.array(stableKey).min(1),
}).strict();

const manifestSchema = z.object({
  scope_key: nonEmptyText.regex(new RegExp(SCOPE_KEY_PATTERN)),
  schema_version: z.literal(1),
  source_decision_id: z.string().uuid(),
  value_streams: z.array(valueStreamSchema).min(1),
  capabilities: z.array(capabilitySchema).min(1),
  boundaries: z.array(boundarySchema),
  crosscut_pool: z.array(crosscutSchema),
  shared_prerequisites: z.object({
    applicable: z.boolean(),
    items: z.array(prerequisiteSchema),
    reason: z.string().trim().optional(),
  }).strict(),
}).strict();

const stableKeyJsonSchema = { type: 'string', minLength: 1, pattern: STABLE_KEY_PATTERN };
const nonEmptyJsonSchema = { type: 'string', minLength: 1, pattern: '\\S' };
const aliasesJsonSchema = { type: 'array', items: stableKeyJsonSchema };

export const MAP_MANIFEST_JSON_SCHEMA = Object.freeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'urn:universal-map:manifest:v1',
  title: 'Universal Map Manifest v1',
  type: 'object',
  additionalProperties: false,
  required: [
    'scope_key', 'schema_version', 'source_decision_id', 'value_streams', 'capabilities',
    'boundaries', 'crosscut_pool', 'shared_prerequisites',
  ],
  properties: {
    scope_key: { type: 'string', pattern: SCOPE_KEY_PATTERN },
    schema_version: { const: 1 },
    source_decision_id: { type: 'string', format: 'uuid' },
    value_streams: { type: 'array', minItems: 1, items: { $ref: '#/$defs/value_stream' } },
    capabilities: { type: 'array', minItems: 1, items: { $ref: '#/$defs/capability' } },
    boundaries: { type: 'array', items: { $ref: '#/$defs/boundary' } },
    crosscut_pool: { type: 'array', items: { $ref: '#/$defs/crosscut' } },
    shared_prerequisites: { $ref: '#/$defs/shared_prerequisites' },
  },
  $defs: {
    value_stream: {
      type: 'object', additionalProperties: false,
      required: ['key', 'name', 'perceiver', 'order'],
      properties: {
        key: stableKeyJsonSchema, name: nonEmptyJsonSchema, perceiver: nonEmptyJsonSchema,
        order: { type: 'integer', minimum: 1 }, aliases: aliasesJsonSchema,
      },
    },
    capability: {
      type: 'object', additionalProperties: false,
      required: ['key', 'name', 'value_stream_key', 'order'],
      properties: {
        key: stableKeyJsonSchema, name: nonEmptyJsonSchema, value_stream_key: stableKeyJsonSchema,
        order: { type: 'integer', minimum: 1 }, aliases: aliasesJsonSchema,
      },
    },
    boundary: {
      type: 'object', additionalProperties: false,
      required: ['key', 'from', 'to', 'statement'],
      properties: {
        key: stableKeyJsonSchema, from: stableKeyJsonSchema, to: stableKeyJsonSchema,
        statement: nonEmptyJsonSchema,
      },
    },
    crosscut: {
      type: 'object', additionalProperties: false,
      required: ['key', 'name', 'serves'],
      properties: {
        key: stableKeyJsonSchema, name: nonEmptyJsonSchema, aliases: aliasesJsonSchema,
        owner: stableKeyJsonSchema,
        serves: { type: 'array', minItems: 1, items: stableKeyJsonSchema },
      },
    },
    prerequisite: {
      type: 'object', additionalProperties: false,
      required: ['key', 'name', 'serves'],
      properties: {
        key: stableKeyJsonSchema, name: nonEmptyJsonSchema, aliases: aliasesJsonSchema,
        serves: { type: 'array', minItems: 1, items: stableKeyJsonSchema },
      },
    },
    shared_prerequisites: {
      type: 'object', additionalProperties: false,
      required: ['applicable', 'items'],
      properties: {
        applicable: { type: 'boolean' },
        items: { type: 'array', items: { $ref: '#/$defs/prerequisite' } },
        reason: { type: 'string', pattern: '\\S' },
      },
      allOf: [{
        if: { properties: { applicable: { const: false } }, required: ['applicable'] },
        then: {
          properties: { items: { type: 'array', maxItems: 0 }, reason: { type: 'string', minLength: 1 } },
          required: ['reason'],
        },
        else: { properties: { items: { type: 'array', minItems: 1 } } },
      }],
    },
  },
});

const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addFormat('uuid', /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
const validateJsonSchema = ajv.compile(MAP_MANIFEST_JSON_SCHEMA);

function pathString(path) {
  return path.map(String).join('.');
}

function pointerPath(pointer) {
  if (!pointer) return '';
  return pointer.slice(1).split('/').map((segment) => (
    segment.replaceAll('~1', '/').replaceAll('~0', '~')
  )).join('.');
}

export function validateMapManifestJsonSchema(input) {
  const valid = validateJsonSchema(input);
  const errors = valid ? [] : (validateJsonSchema.errors ?? []).map((error) => {
    let path = pointerPath(error.instancePath);
    if (error.keyword === 'additionalProperties') {
      path = [path, error.params.additionalProperty].filter(Boolean).join('.');
    } else if (error.keyword === 'required') {
      path = [path, error.params.missingProperty].filter(Boolean).join('.');
    }
    return {
      path,
      code: error.keyword === 'additionalProperties' ? 'unrecognized_keys' : error.keyword,
      message: error.message ?? 'JSON Schema validation failed',
    };
  });
  return { valid, errors };
}

function structuralErrors(zodIssues) {
  return zodIssues.flatMap((issue) => {
    if (issue.code === 'unrecognized_keys') {
      return issue.keys.map((key) => ({
        path: pathString([...issue.path, key]),
        code: 'unrecognized_keys',
        message: `Unknown field: ${key}`,
      }));
    }
    return [{
      path: pathString(issue.path),
      code: issue.code,
      message: issue.message,
    }];
  });
}

function pushError(errors, path, code, message) {
  errors.push({ path, code, message });
}

function addUniquePrimaryKeys(manifest, errors) {
  const seen = new Map();
  const groups = [
    ['value_streams', manifest.value_streams],
    ['capabilities', manifest.capabilities],
    ['boundaries', manifest.boundaries],
    ['crosscut_pool', manifest.crosscut_pool],
    ['shared_prerequisites.items', manifest.shared_prerequisites.items],
  ];
  for (const [groupName, items] of groups) {
    items.forEach((item, index) => {
      if (typeof item.key !== 'string') return;
      const path = `${groupName}.${index}.key`;
      if (seen.has(item.key)) {
        pushError(errors, path, 'duplicate_key', `Stable key already used at ${seen.get(item.key)}`);
      } else {
        seen.set(item.key, path);
      }
    });
  }
  for (const [groupName, items] of groups.filter(([name]) => name !== 'boundaries')) {
    items.forEach((item, index) => {
      (Array.isArray(item.aliases) ? item.aliases : []).forEach((alias, aliasIndex) => {
        if (typeof alias !== 'string') return;
        const path = `${groupName}.${index}.aliases.${aliasIndex}`;
        if (seen.has(alias)) {
          pushError(errors, path, 'duplicate_alias', `Alias already used at ${seen.get(alias)}`);
        } else {
          seen.set(alias, path);
        }
      });
    });
  }
}

function addDuplicateOrderErrors(manifest, errors) {
  const seenStreams = new Map();
  manifest.value_streams.forEach((item, index) => {
    if (typeof item.order !== 'number') return;
    if (seenStreams.has(item.order)) {
      pushError(errors, `value_streams.${index}.order`, 'duplicate_order', 'Value Stream order must be unique');
    } else seenStreams.set(item.order, index);
  });

  const seenCapabilities = new Map();
  manifest.capabilities.forEach((item, index) => {
    if (typeof item.value_stream_key !== 'string' || typeof item.order !== 'number') return;
    const groupOrder = `${item.value_stream_key}:${item.order}`;
    if (seenCapabilities.has(groupOrder)) {
      pushError(errors, `capabilities.${index}.order`, 'duplicate_order', 'Capability order must be unique within its Value Stream');
    } else seenCapabilities.set(groupOrder, index);
  });
}

function addReferenceErrors(manifest, errors) {
  const streams = new Set(manifest.value_streams.map(({ key }) => key).filter((key) => typeof key === 'string'));
  const capabilities = new Set(manifest.capabilities.map(({ key }) => key).filter((key) => typeof key === 'string'));
  const requireRef = (exists, value, path, type) => {
    if (typeof value !== 'string') return;
    if (!exists.has(value)) pushError(errors, path, 'reference_not_found', `${type} does not exist: ${value}`);
  };

  manifest.capabilities.forEach((item, index) => {
    requireRef(streams, item.value_stream_key, `capabilities.${index}.value_stream_key`, 'Value Stream');
  });
  manifest.boundaries.forEach((item, index) => {
    requireRef(capabilities, item.from, `boundaries.${index}.from`, 'Capability');
    requireRef(capabilities, item.to, `boundaries.${index}.to`, 'Capability');
  });
  manifest.crosscut_pool.forEach((item, index) => {
    (Array.isArray(item.serves) ? item.serves : []).forEach((stream, servesIndex) => {
      requireRef(streams, stream, `crosscut_pool.${index}.serves.${servesIndex}`, 'Value Stream');
    });
    if (item.owner) requireRef(capabilities, item.owner, `crosscut_pool.${index}.owner`, 'Capability');
  });
  manifest.shared_prerequisites.items.forEach((item, index) => {
    (Array.isArray(item.serves) ? item.serves : []).forEach((stream, servesIndex) => {
      requireRef(streams, stream, `shared_prerequisites.items.${index}.serves.${servesIndex}`, 'Value Stream');
    });
  });
}

function boundariesContainCycle(boundaries) {
  const adjacency = new Map();
  for (const { from, to } of boundaries) {
    if (typeof from !== 'string' || typeof to !== 'string') continue;
    if (!adjacency.has(from)) adjacency.set(from, []);
    adjacency.get(from).push(to);
  }
  const visiting = new Set();
  const visited = new Set();
  const visit = (key) => {
    if (visiting.has(key)) return true;
    if (visited.has(key)) return false;
    visiting.add(key);
    if ((adjacency.get(key) ?? []).some(visit)) return true;
    visiting.delete(key);
    visited.add(key);
    return false;
  };
  return [...adjacency.keys()].some(visit);
}

function semanticErrors(manifest) {
  const errors = [];
  addUniquePrimaryKeys(manifest, errors);
  addDuplicateOrderErrors(manifest, errors);
  addReferenceErrors(manifest, errors);

  if (manifest.shared_prerequisites.applicable === false) {
    if (manifest.shared_prerequisites.items.length > 0) {
      pushError(errors, 'shared_prerequisites.items', 'not_applicable_items', 'Items must be empty when shared prerequisites are not applicable');
    }
    if (!manifest.shared_prerequisites.reason?.trim()) {
      pushError(errors, 'shared_prerequisites.reason', 'not_applicable_reason', 'Reason is required when shared prerequisites are not applicable');
    }
  } else if (manifest.shared_prerequisites.applicable === true
    && manifest.shared_prerequisites.items.length === 0) {
    pushError(errors, 'shared_prerequisites.items', 'applicable_items_required', 'Applicable shared prerequisites require at least one item');
  }

  // PRD §6.1 requires the projector input to reject cyclic boundary graphs.
  if (boundariesContainCycle(manifest.boundaries)) {
    pushError(errors, 'boundaries', 'cycle_detected', 'Boundary graph must be acyclic');
  }
  return errors;
}

function objectItems(value) {
  return Array.isArray(value)
    ? value.filter((item) => item && typeof item === 'object' && !Array.isArray(item))
    : [];
}

function semanticView(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const shared = input.shared_prerequisites;
  const sharedObject = shared && typeof shared === 'object' && !Array.isArray(shared) ? shared : {};
  return {
    value_streams: objectItems(input.value_streams),
    capabilities: objectItems(input.capabilities),
    boundaries: objectItems(input.boundaries),
    crosscut_pool: objectItems(input.crosscut_pool),
    shared_prerequisites: {
      applicable: sharedObject.applicable,
      items: objectItems(sharedObject.items),
      reason: sharedObject.reason,
    },
  };
}

function uniqueErrors(errors) {
  const seen = new Set();
  return errors.filter((error) => {
    const identity = `${error.path}:${error.code}`;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

export function validateMapManifest(input) {
  const jsonResult = validateMapManifestJsonSchema(input);
  const parsed = manifestSchema.safeParse(input);
  const view = semanticView(input);
  const errors = uniqueErrors([
    ...jsonResult.errors,
    ...(parsed.success ? [] : structuralErrors(parsed.error.issues)),
    ...(view ? semanticErrors(view) : []),
  ]);
  return errors.length > 0
    ? { valid: false, errors }
    : { valid: true, errors: [], manifest: parsed.data };
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, sortJson(value[key])]),
    );
  }
  return value;
}

export function canonicalizeMapManifest(manifest) {
  return JSON.stringify(sortJson(manifest));
}

export function digestMapManifest(manifest) {
  return createHash('sha256')
    .update(canonicalizeMapManifest(manifest), 'utf8')
    .digest('hex');
}
