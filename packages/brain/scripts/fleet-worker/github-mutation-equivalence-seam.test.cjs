'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { test } = require('node:test');

const {
  createBranchProtectionEquivalenceSeam,
  createBranchPushEquivalenceSeam,
} = require('./github-mutation-broker.cjs');

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const ATTEMPT_ID = '22222222-2222-4222-8222-222222222222';
const RESOURCE_ID = '33333333-3333-4333-8333-333333333333';

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(
    (key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
  ).join(',')}}`;
}

function digest(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

const DESCRIPTORS = [
  {
    name: 'branch protection',
    seamId: 'kernel.workspace.protected_ref_guard',
    adapterId: 'kernel.drill.branch_protection.v1',
    behaviorId: 'KERNEL-P0-01-BRANCH-PROTECTION',
    factory: createBranchProtectionEquivalenceSeam,
    effects: {
      normal: ['confirmed', 'protected_ref_scope_allowed'],
      violation: ['denied', 'protected_ref_mutation_denied'],
      recovery: ['recovered', 'protected_ref_scope_recovered'],
    },
  },
  {
    name: 'branch push',
    seamId: 'kernel.github.mutation_broker',
    adapterId: 'kernel.drill.branch_push_guard.v1',
    behaviorId: 'KERNEL-P0-03-BRANCH-PUSH-GUARD',
    factory: createBranchPushEquivalenceSeam,
    effects: {
      normal: ['confirmed', 'scoped_push_confirmed'],
      violation: ['denied', 'out_of_scope_push_denied'],
      recovery: ['recovered', 'corrected_ref_push_confirmed'],
    },
  },
];

function cell(descriptor, scenario) {
  return {
    cell_id: `${descriptor.behaviorId}::codex::${scenario}`,
    behavior_id: descriptor.behaviorId,
    provider: 'codex',
    scenario,
    seam_id: descriptor.seamId,
    adapter_id: descriptor.adapterId,
  };
}

function grant(descriptor) {
  return {
    grant_id: '44444444-4444-4444-8444-444444444444',
    nonce: '55555555-5555-4555-8555-555555555555',
    run_id: RUN_ID,
    attempt_id: ATTEMPT_ID,
    resource_id: RESOURCE_ID,
    resource_ref: `equivalence-drill/${RUN_ID}/${ATTEMPT_ID}/git`,
    seam_id: descriptor.seamId,
    adapter_id: descriptor.adapterId,
  };
}

function predecessor(descriptor) {
  return Object.freeze({
    grant: Object.freeze({ ...grant(descriptor) }),
    receipt: Object.freeze({
      schema_version: 'kernel-equivalence-effect-receipt/v1',
      receipt_id: '66666666-6666-4666-8666-666666666666',
      effect_code: descriptor.effects.violation[1],
    }),
  });
}

function fixture(descriptor, scenario) {
  const input = Object.freeze({
    state: { attempt_id: ATTEMPT_ID, run_id: RUN_ID },
    policy: { branch: 'cp-equivalence-safe' },
    declarationBytes: Buffer.from('{}'),
    providerResultBytes: Buffer.from('{}'),
  });
  const result = {
    receipt: {
      stage: 'draft_pr_confirmed',
      head_sha: 'a'.repeat(40),
      pull_request: {
        state: 'OPEN',
        head_sha: 'a'.repeat(40),
      },
    },
  };
  const mutationBroker = {
    execute: async () => {
      if (scenario === 'violation') {
        const error = new Error(
          descriptor.name === 'branch protection'
            ? 'github_mutation_policy_invalid'
            : 'github_mutation_path_not_allowed',
        );
        error.code = error.message;
        throw error;
      }
      return result;
    },
  };
  let snapshots = [
    { remote_sha: null, draft_pr: null },
    {
      remote_sha: scenario === 'violation' ? null : 'a'.repeat(40),
      draft_pr: scenario === 'violation' ? null : 4401,
    },
  ];
  const mutationAuthority = {
    owner_service: descriptor.seamId,
    loadInput: async () => input,
    snapshot: async () => snapshots.shift(),
    confirmDenial: async ({ error }) => error?.code?.startsWith('github_mutation_'),
    confirmSuccess: async ({ result: observed }) => (
      observed?.receipt?.stage === 'draft_pr_confirmed'
    ),
    confirmRecovery: async ({ predecessor: previous }) => (
      previous?.receipt?.effect_code === descriptor.effects.violation[1]
    ),
    cancel: async () => ({ confirmed: true }),
    cleanup: async () => ({ confirmed: true }),
  };
  const signed = [];
  const effectSigner = {
    async signEffectResult(inputValue) {
      signed.push(inputValue);
      return {
        schema_version: 'kernel-equivalence-effect-receipt/v1',
        ...inputValue.observation,
        signature: 'signed',
      };
    },
  };
  return {
    mutationBroker,
    mutationAuthority,
    effectSigner,
    signed,
    seam: descriptor.factory({
      mutationBroker,
      mutationAuthority,
      effectSigner,
    }),
  };
}

for (const descriptor of DESCRIPTORS) {
  for (const scenario of ['normal', 'violation', 'recovery']) {
    test(`${descriptor.name} ${scenario} uses broker and server-owned evidence`, async () => {
      const value = fixture(descriptor, scenario);
      const targetCell = cell(descriptor, scenario);
      const targetGrant = grant(descriptor);
      const previous = scenario === 'recovery' ? predecessor(descriptor) : null;
      const receipt = await value.seam.invoke({
        cell: targetCell,
        grant: targetGrant,
        resource: {
          resource_id: RESOURCE_ID,
          resource_ref: targetGrant.resource_ref,
          policy: { branch: 'main' },
        },
        predecessor: previous,
        signal: AbortSignal.timeout(1_000),
      });

      assert.equal(receipt.observed_outcome, descriptor.effects[scenario][0]);
      assert.equal(receipt.effect_code, descriptor.effects[scenario][1]);
      assert.deepEqual(value.signed, [{
        cell: targetCell,
        grant: targetGrant,
        observation: {
          observed_outcome: descriptor.effects[scenario][0],
          effect_code: descriptor.effects[scenario][1],
          before_hash: digest({ remote_sha: null, draft_pr: null }),
          after_hash: digest({
            remote_sha: scenario === 'violation' ? null : 'a'.repeat(40),
            draft_pr: scenario === 'violation' ? null : 4401,
          }),
        },
        predecessor: previous,
      }]);
    });
  }

  test(`${descriptor.name} fails closed on unconfirmed denial`, async () => {
    const value = fixture(descriptor, 'violation');
    value.mutationAuthority.confirmDenial = async () => false;
    const seam = descriptor.factory({
      mutationBroker: value.mutationBroker,
      mutationAuthority: value.mutationAuthority,
      effectSigner: value.effectSigner,
    });
    await assert.rejects(
      seam.invoke({
        cell: cell(descriptor, 'violation'),
        grant: grant(descriptor),
        resource: {
          resource_id: RESOURCE_ID,
          resource_ref: grant(descriptor).resource_ref,
        },
        signal: AbortSignal.timeout(1_000),
      }),
      { code: 'github_mutation_denial_unconfirmed' },
    );
    assert.equal(value.signed.length, 0);
  });

  test(`${descriptor.name} requires exact owner and resource`, async () => {
    const value = fixture(descriptor, 'normal');
    assert.throws(() => descriptor.factory({
      mutationBroker: value.mutationBroker,
      mutationAuthority: {
        ...value.mutationAuthority,
        owner_service: 'caller',
      },
      effectSigner: value.effectSigner,
    }), /github_mutation_equivalence_authority_unavailable/);
    await assert.rejects(
      value.seam.invoke({
        cell: cell(descriptor, 'normal'),
        grant: grant(descriptor),
        resource: {
          resource_id: RESOURCE_ID,
          resource_ref: 'equivalence-drill/other',
        },
        signal: AbortSignal.timeout(1_000),
      }),
      { code: 'github_mutation_equivalence_resource_invalid' },
    );
    assert.equal(value.signed.length, 0);
  });
}
