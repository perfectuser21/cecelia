import { z } from 'zod';

export const COMMANDER_MODES = Object.freeze([
  'legacy-session',
  'kernel-only',
  'hybrid',
]);

export const COMMANDER_ACTIONS = Object.freeze([
  'continue_default',
  'dispatch_role',
  'retry_attempt',
  'revise_guidance',
  'switch_provider',
  'switch_machine',
  'pause_run',
  'request_human',
  'abort_run',
]);

export const ACTOR_KEYS = Object.freeze([
  'commander',
  'planner',
  'proposer',
  'reviewer',
  'generator',
  'evaluator',
  'judge',
]);

export const ACTOR_MESSAGE_TYPES = Object.freeze([
  'instruction',
  'question',
  'answer',
  'review_feedback',
  'evidence_request',
  'escalation',
]);

const SECRET_KEY = /token|secret|password|api[_-]?key|auth(?:entication|orization)?|credential_payload/i;
const ACTOR_SIDE_EFFECT_KEY = /^(?:action|route|command|cli(?:_command)?|cwd|working_directory|session_id|provider_session_id)$/i;
const MAX_TEXT_LENGTH = 4_000;
const MAX_ARRAY_ITEMS = 128;
const MAX_DEPTH = 32;

function inspectStructuredValue(value, context, depth = 0, seen = new WeakSet()) {
  if (depth > MAX_DEPTH) {
    context.addIssue({ code: 'custom', message: 'structured_value_too_deep' });
    return;
  }
  if (typeof value === 'string') {
    if (value.length > MAX_TEXT_LENGTH) {
      context.addIssue({ code: 'custom', message: 'free_text_too_long' });
    }
    return;
  }
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return;
  if (typeof value !== 'object') {
    context.addIssue({ code: 'custom', message: 'non_json_value_forbidden' });
    return;
  }
  if (seen.has(value)) {
    context.addIssue({ code: 'custom', message: 'cyclic_value_forbidden' });
    return;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_ITEMS) {
      context.addIssue({ code: 'custom', message: 'array_item_limit_exceeded' });
      return;
    }
    for (const item of value) inspectStructuredValue(item, context, depth + 1, seen);
    return;
  }

  const entries = Object.entries(value);
  if (entries.length > MAX_ARRAY_ITEMS) {
    context.addIssue({ code: 'custom', message: 'object_key_limit_exceeded' });
    return;
  }
  for (const [key, nested] of entries) {
    if (SECRET_KEY.test(key)) {
      context.addIssue({ code: 'custom', message: 'secret_material_forbidden' });
      continue;
    }
    if (context.forbidActorEffects && ACTOR_SIDE_EFFECT_KEY.test(key)) {
      context.addIssue({ code: 'custom', message: 'actor_side_effect_forbidden' });
      continue;
    }
    inspectStructuredValue(nested, context, depth + 1, seen);
  }
}

function structuredObject({ forbidActorEffects = false } = {}) {
  return z.record(z.string().max(256), z.unknown()).superRefine((value, context) => {
    inspectStructuredValue(value, { ...context, forbidActorEffects });
  });
}

const evidenceRefSchema = z.string().max(512).regex(
  /^(?:event:[1-9]\d*|attempt:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i,
);
const actorKeySchema = z.enum(ACTOR_KEYS);
const commanderActionSchema = z.enum(COMMANDER_ACTIONS);

const actorMessageSchema = z.object({
  schema: z.literal('harness-actor-message/v1'),
  message_id: z.uuid(),
  run_id: z.uuid(),
  sender_role: actorKeySchema,
  recipient_role: actorKeySchema,
  thread_id: z.uuid(),
  correlation_id: z.string().min(1).max(512),
  source_attempt_id: z.uuid().nullable(),
  event_cursor: z.number().int().nonnegative(),
  message_type: z.enum(ACTOR_MESSAGE_TYPES),
  payload: structuredObject({ forbidActorEffects: true }),
  evidence_refs: z.array(evidenceRefSchema).max(MAX_ARRAY_ITEMS),
  dedupe_key: z.string().min(1).max(512),
}).strict();

const routeSchema = z.object({
  machine: z.string().min(1).max(256).optional(),
  provider: z.string().min(1).max(128).optional(),
  account: z.string().min(1).max(128).optional(),
  model: z.string().min(1).max(256).optional(),
}).strict();

const commanderDirectiveSchema = z.object({
  schema: z.literal('commander-directive/v1'),
  run_id: z.uuid(),
  event_cursor: z.number().int().nonnegative(),
  action: commanderActionSchema,
  target_role: actorKeySchema.optional(),
  target_attempt_id: z.uuid().optional(),
  reason: z.string().min(1).max(MAX_TEXT_LENGTH),
  guidance: z.string().max(MAX_TEXT_LENGTH).optional(),
  route: routeSchema.optional(),
  evidence_refs: z.array(evidenceRefSchema).min(1).max(MAX_ARRAY_ITEMS),
}).strict().superRefine((value, context) => {
  inspectStructuredValue(value, context);
});

const commanderEventSchema = z.object({
  run_id: z.uuid(),
  cursor: z.number().int().positive(),
  event_type: z.string().min(1).max(256),
  source_type: z.string().min(1).max(256),
  source_id: z.string().min(1).max(512),
  source_version: z.number().int().nonnegative(),
  payload: structuredObject(),
  occurred_at: z.union([z.string().max(128), z.date()]).optional(),
  created_at: z.union([z.string().max(128), z.date()]).optional(),
}).strict();

const commanderBundleSchema = z.object({
  schema: z.literal('commander-bundle/v1'),
  run_id: z.uuid(),
  commander_attempt_id: z.uuid(),
  event_cursor: z.number().int().nonnegative(),
  run_profile: structuredObject(),
  objective: structuredObject(),
  observed: structuredObject(),
  history_summary: structuredObject(),
  new_events: z.array(commanderEventSchema).max(MAX_ARRAY_ITEMS),
  actor_messages: z.array(actorMessageSchema).max(MAX_ARRAY_ITEMS),
  active_risks: z.array(z.unknown()).max(MAX_ARRAY_ITEMS),
  budgets: structuredObject(),
  allowed_actions: z.array(commanderActionSchema).max(COMMANDER_ACTIONS.length),
  output_schema: z.literal('commander-directive/v1'),
}).strict().superRefine((value, context) => {
  inspectStructuredValue(value.active_risks, context);
});

export function assertNoSecretMaterial(value) {
  const issues = [];
  inspectStructuredValue(value, {
    addIssue(issue) {
      issues.push(issue);
    },
    forbidActorEffects: false,
  });
  if (issues.length > 0) {
    throw new Error(issues[0].message);
  }
  return value;
}

export function parseCommanderMode(value) {
  return z.enum(COMMANDER_MODES).parse(value);
}

export function parseCommanderBundle(value) {
  return commanderBundleSchema.parse(value);
}

export function parseCommanderDirective(value) {
  return commanderDirectiveSchema.parse(value);
}

export function parseActorMessage(value) {
  const message = actorMessageSchema.parse(value);
  if (message.sender_role === message.recipient_role) {
    throw new Error('actor_sender_recipient_must_differ');
  }
  return message;
}
