import {
  loadEffectReceiptSigner,
} from './kernel-equivalence-signers.js';
import {
  TRUSTED_NON_RELEASE_EQUIVALENCE_DESCRIPTORS,
} from './kernel-equivalence-trusted-assembly.js';

const PROVIDERS = Object.freeze(['claude', 'codex', 'grok']);
const SCENARIOS = Object.freeze(['normal', 'violation', 'recovery']);
const SIGNING_KEY_FIELDS = Object.freeze(['key_id', 'secret_file']);
const REQUIRED_SEAMS = Object.freeze(
  TRUSTED_NON_RELEASE_EQUIVALENCE_DESCRIPTORS
    .map(({ seam_id: seamId }) => seamId)
    .sort(),
);

export class KernelProductionEffectSignerError extends Error {
  constructor(code) {
    super(code);
    this.name = 'KernelProductionEffectSignerError';
    this.code = code;
  }
}

function fail(code) {
  throw new KernelProductionEffectSignerError(code);
}

function dataSnapshot(value, expectedFields, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(code);
  }
  let descriptors;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    fail(code);
  }
  const fields = Reflect.ownKeys(descriptors);
  if (
    fields.some((field) => typeof field !== 'string')
    || fields.length !== expectedFields.length
    || fields.sort().some((field, index) => (
      field !== expectedFields[index]
    ))
  ) {
    fail(code);
  }
  const result = {};
  for (const field of expectedFields) {
    const descriptor = descriptors[field];
    if (
      !descriptor
      || !Object.hasOwn(descriptor, 'value')
      || descriptor.enumerable !== true
    ) {
      fail(code);
    }
    result[field] = descriptor.value;
  }
  return Object.freeze(result);
}

function snapshotSigningKeys(value) {
  const set = dataSnapshot(
    value,
    REQUIRED_SEAMS,
    'production_effect_signing_key_set_invalid',
  );
  return Object.freeze(Object.fromEntries(REQUIRED_SEAMS.map((seamId) => {
    const key = dataSnapshot(
      set[seamId],
      SIGNING_KEY_FIELDS,
      'production_effect_signing_key_invalid',
    );
    if (
      typeof key.key_id !== 'string'
      || key.key_id.length < 1
      || key.key_id.length > 2_048
      || /[\0\r\n]/.test(key.key_id)
      || typeof key.secret_file !== 'string'
      || key.secret_file.length < 1
      || key.secret_file.length > 4_096
      || /[\0\r\n]/.test(key.secret_file)
    ) {
      fail('production_effect_signing_key_invalid');
    }
    return [seamId, key];
  })));
}

function pinPlan(plan) {
  let pinned;
  try {
    pinned = structuredClone(plan);
  } catch {
    fail('production_effect_plan_invalid');
  }
  if (
    pinned?.schema_version !== 'kernel-equivalence-drill-plan/v1'
    || pinned?.behavior_count !== 11
    || !Array.isArray(pinned.cells)
    || pinned.cells.length !== 99
  ) {
    fail('production_effect_plan_invalid');
  }
  for (const descriptor of TRUSTED_NON_RELEASE_EQUIVALENCE_DESCRIPTORS) {
    const cells = pinned.cells.filter(({ behavior_id: behaviorId } = {}) => (
      behaviorId === descriptor.behavior_id
    ));
    const keyIds = new Set(cells.map(({ effect_key_id: keyId }) => keyId));
    if (
      cells.length !== PROVIDERS.length * SCENARIOS.length
      || keyIds.size !== 1
      || cells.some((cell) => (
        cell.seam_id !== descriptor.seam_id
        || cell.adapter_id !== descriptor.adapter_id
        || cell.effect_signer_status !== 'available'
        || cell.blocked_by !== null
        || typeof cell.effect_key_id !== 'string'
        || cell.effect_key_id.length < 1
        || cell.cell_id
          !== `${descriptor.behavior_id}::${cell.provider}::${cell.scenario}`
        || !PROVIDERS.includes(cell.provider)
        || !SCENARIOS.includes(cell.scenario)
      ))
      || new Set(cells.map(({ cell_id: cellId }) => cellId)).size
        !== cells.length
    ) {
      fail('production_effect_plan_invalid');
    }
  }
  return Object.freeze(pinned);
}

export function loadProductionEffectSignerSet({
  plan,
  trustRegistry,
  signingKeys,
  now = Date.now,
} = {}) {
  if (typeof now !== 'function') {
    fail('production_effect_signer_configuration_invalid');
  }
  const pinnedPlan = pinPlan(plan);
  const pinnedKeys = snapshotSigningKeys(signingKeys);
  const signers = {};
  for (const descriptor of TRUSTED_NON_RELEASE_EQUIVALENCE_DESCRIPTORS) {
    const expectedKeyId = pinnedPlan.cells.find((cell) => (
      cell.behavior_id === descriptor.behavior_id
    )).effect_key_id;
    const key = pinnedKeys[descriptor.seam_id];
    if (key.key_id !== expectedKeyId) {
      fail('production_effect_plan_invalid');
    }
    signers[descriptor.seam_id] = loadEffectReceiptSigner({
      secretFile: key.secret_file,
      keyId: key.key_id,
      serviceId: descriptor.seam_id,
      trustRegistry,
      now,
    });
  }
  return Object.freeze(signers);
}
