# Kernel Behavior Equivalence Drills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a zero-fabrication 99-cell drill planner, signed execution-grant/effect-receipt verifier, fail-closed runner/collector boundary, and trusted resolver for the existing Kernel behavior equivalence contract.

**Architecture:** Extend each of the 11 root behavior descriptors with a canonical drill declaration and compile the Provider/Scenario Cartesian product instead of introducing a second inventory. Separate manifest planning, Ed25519 trust verification, execution orchestration, receipt collection, and proof validation into focused pure modules; the production CLI has no private keys or registered signer adapters in this phase, so every real execute request remains fail-closed.

**Tech Stack:** Node.js ESM, Node `crypto` Ed25519/SHA-256, Vitest, js-yaml, existing root `regression-contract.yaml`.

---

## File map

- `regression-contract.yaml`: sole 11-descriptor drill manifest and public trust registry.
- `packages/brain/src/lib/kernel-equivalence-drills.js`: descriptor validator, 99-cell compiler, execution preflight and denial audit.
- `packages/brain/src/lib/kernel-equivalence-receipts.js`: canonical JSON, Ed25519/key-lifecycle verification, grant/effect/bundle/hash-chain verification.
- `packages/brain/src/lib/kernel-equivalence-receipt-resolver.js`: restricted raw bundle reference resolver.
- `packages/brain/src/lib/kernel-behavior-equivalence.js`: proven status consumes verified bundle results; strings no longer prove effects.
- `packages/brain/src/lib/__tests__/kernel-equivalence-drills.test.js`: manifest/99-cell/runner/zero-write tests.
- `packages/brain/src/lib/__tests__/kernel-equivalence-receipts.test.js`: trust, signature, grant, effect, bundle and recovery lineage tests.
- `packages/brain/src/lib/__tests__/kernel-behavior-equivalence.test.js`: false-string-proof regression and signed 9-cell proof fixtures.
- `scripts/ci/run-kernel-equivalence-drill.mjs`: `--plan`, `--check`, fail-closed `--execute`.
- `docs/reviews/2026-07-28-kernel-equivalence-signer-adapter-plan.md`: deterministic next-round seam signer inventory.
- Version/definition files: Brain `1.268.7`, rollback `1.268.6`.

### Task 1: Canonical descriptors and exact 99-cell compiler

**Files:**
- Create: `packages/brain/src/lib/__tests__/kernel-equivalence-drills.test.js`
- Create: `packages/brain/src/lib/kernel-equivalence-drills.js`
- Modify: `regression-contract.yaml`
- Modify: `packages/quality/__tests__/regression-contract.test.js`

- [ ] **Step 1: Write the failing manifest compiler tests**

Create fixtures that call:

```js
const result = compileDrillPlan(contract);
expect(result.cells).toHaveLength(99);
expect(new Set(result.cells.map((cell) => cell.cell_id))).toHaveLength(99);
expect(result.cells.every((cell) => cell.blocked_by === 'seam_receipt_signer_missing')).toBe(true);
```

Add table tests deleting one scenario, duplicating one behavior, using `main`, using
`production`, and declaring `effect_signer_status=available` without an active
`effect_receipt` key. Each must produce a stable error code and no cells.

- [ ] **Step 2: Run RED**

Run:

```bash
cd packages/brain
npx vitest run src/lib/__tests__/kernel-equivalence-drills.test.js
```

Expected: fail because `kernel-equivalence-drills.js` does not exist.

- [ ] **Step 3: Implement the minimal compiler**

Export:

```js
export class EquivalenceDrillError extends Error {
  constructor(code, detail = null) {
    super(code);
    this.name = 'EquivalenceDrillError';
    this.code = code;
    this.detail = detail;
  }
}

export function compileDrillPlan(contract) {
  // Validate exactly 11 descriptors and normal/violation/recovery.
  // Expand fixed claude/codex/grok axes.
  // Reject unsafe environment/ref/resource values.
  // Return deterministic cells sorted by behavior/provider/scenario.
}
```

`cell_id` is
`<behavior_id>::<provider>::<scenario>`. Every cell carries seam, adapter,
isolation, expected outcome, signer status and blocker.

- [ ] **Step 4: Add all 11 root descriptors and empty public registry**

Add `drill_trust_registry` with `algorithm: ed25519`, empty key list, lifecycle
limits and replay policy. Add a behavior-specific `drill` block to every existing
behavior with real `seam_ref`, three explicit scenarios, isolated resource policy,
`effect_signer_status: missing`, and
`blocked_by: seam_receipt_signer_missing`.

Extend the quality test to require exactly 11 descriptors, three scenarios, and
99 unique compiled cells.

- [ ] **Step 5: Run GREEN and commit**

Run Brain and quality focused tests. Commit RED separately, then implementation:

```bash
git commit -m "test(kernel): require canonical 99-cell drill plan [RED]"
git commit -m "feat(kernel): compile canonical equivalence drill plan"
```

### Task 2: Ed25519 trust, execution grants, and effect receipts

**Files:**
- Create: `packages/brain/src/lib/__tests__/kernel-equivalence-receipts.test.js`
- Create: `packages/brain/src/lib/kernel-equivalence-receipts.js`

- [ ] **Step 1: Write failing crypto contract tests**

Generate ephemeral Ed25519 key pairs inside tests and exercise real Node crypto.
Tests must cover:

```js
expect(verifyExecutionGrant(signedGrant, registry, expected, { now })).toMatchObject({
  grant_id: signedGrant.grant_id,
  cell_id: expected.cell_id,
});
expect(() => verifyEffectReceipt(tampered, registry, expected, { now }))
  .toThrowError(expect.objectContaining({ code: 'effect_signature_invalid' }));
```

Add independent cases for wrong purpose, expired/not-yet-active/revoked key,
expired grant, axis/version/artifact/resource mismatch, non-live execution mode,
violation without denial, and recovery without exact violation predecessor.

- [ ] **Step 2: Run RED**

Run the new test and observe module/API absence.

- [ ] **Step 3: Implement canonical signing payloads and verification**

Export:

```js
export function canonicalJson(value) {}
export function sha256Canonical(value) {}
export function verifyExecutionGrant(grant, registry, expected, options) {}
export function verifyEffectReceipt(receipt, registry, expected, options) {}
export function verifyReceiptBundle(bundle, registry, expected, options) {}
export function assembleUnsignedBundle({ receipts, previousBundleHash }) {}
```

Signatures are base64 Ed25519 over canonical payload excluding `signature`.
Reject unknown fields that affect identity only by requiring exact schema and all
mandatory binding fields. Verify effect signatures before collector bundle
signature. Recovery verifies predecessor receipt id and SHA-256 hash.

- [ ] **Step 4: Run GREEN and commit**

Run the receipt and existing behavior tests. Commit:

```bash
git commit -m "test(kernel): require signed effect receipt proofs [RED]"
git commit -m "feat(kernel): verify signed equivalence receipts"
```

### Task 3: Restricted resolver and false-string-proof regression

**Files:**
- Create: `packages/brain/src/lib/kernel-equivalence-receipt-resolver.js`
- Create: `packages/brain/src/lib/__tests__/kernel-equivalence-receipt-resolver.test.js`
- Modify: `packages/brain/src/lib/kernel-behavior-equivalence.js`
- Modify: `packages/brain/src/lib/__tests__/kernel-behavior-equivalence.test.js`

- [ ] **Step 1: Write RED tests for resolver and validator**

Require references to use `receipt-bundle:<sha256>` and resolve through an
injected read-only resolver. Reject path traversal, symlink escape, missing bundle,
id/hash mismatch and malformed JSON.

Change the proven fixture test so a non-empty fake
`effect_receipt_id: "receipt:test"` demotes to gap. Build a complete nine-cell
fixture using ephemeral grant/effect/collector Ed25519 signatures and assert only
that fixture becomes proven.

- [ ] **Step 2: Run RED**

Run resolver and behavior tests. Expected failures:
fake strings remain accepted and resolver module is missing.

- [ ] **Step 3: Implement resolver and validator integration**

Export a resolver factory that accepts a caller-provided raw reader:

```js
export function createTrustedReceiptResolver({ readBundle, trustRegistry, now }) {
  return function resolve(reference, expected) {
    // Validate reference, read raw object, verify hash and signatures,
    // return verified identity/effect metadata.
  };
}
```

`validateBehaviorEquivalence(contract, { now, receiptResolver })` requires each
proven matrix cell to contain `receipt_bundle_ref`; it calls the resolver with all
expected axes and compares the returned receipt id. Missing resolver or any
verification error produces a finding and effective gap.

Replace executable-test acceptance with the exact formal drill runner shape and
reject `vitest`, `unit`, `mock`, `dry-run`, static/docs/file/smoke commands.

- [ ] **Step 4: Run GREEN and commit**

Run the three focused suites and commit RED/GREEN.

### Task 4: Fail-closed single-cell runner and denial audit

**Files:**
- Modify: `packages/brain/src/lib/kernel-equivalence-drills.js`
- Modify: `packages/brain/src/lib/__tests__/kernel-equivalence-drills.test.js`

- [ ] **Step 1: Write runner RED tests**

Define the wished-for API:

```js
const result = await executeDrillCell({
  cell,
  grant,
  trustRegistry,
  nonceConsumer,
  adapters,
  collector,
  auditSink,
  now,
});
```

Test that missing signer/adapter, grant rejection, nonce rejection, timeout,
unsigned effect result, invalid signature, axis mismatch, collector rejection,
and cleanup failure all return `status: blocked`, emit a secret-free denial audit,
and never return a receipt bundle.

For one fully signed ephemeral test adapter, assert ordering:
grant verify → nonce consume → prepare → actual seam → receipt verify → cleanup →
collector. The fixture result is test-only and never enters the root contract.

- [ ] **Step 2: Run RED**

Expected: `executeDrillCell` missing.

- [ ] **Step 3: Implement minimal orchestration**

Inject all authorities:

```js
export async function executeDrillCell({
  cell,
  grant,
  trustRegistry,
  nonceConsumer,
  adapters = new Map(),
  collector,
  auditSink,
  now = Date.now(),
  timeoutMs = 60_000,
}) {}
```

No default nonce consumer, adapter, collector, signer or private key exists.
Missing authority blocks. All audits use an allowlist of ids/codes/timestamps and
never serialize grant payloads, credentials, signatures or process environment.

- [ ] **Step 4: Run GREEN and commit**

Commit RED/GREEN after focused tests.

### Task 5: Zero-write CLI, plan/check, and signer handoff report

**Files:**
- Create: `scripts/ci/run-kernel-equivalence-drill.mjs`
- Create: `docs/reviews/2026-07-28-kernel-equivalence-signer-adapter-plan.md`
- Modify: `scripts/ci/check-kernel-behavior-equivalence.mjs`
- Modify: `packages/brain/src/lib/__tests__/kernel-equivalence-drills.test.js`

- [ ] **Step 1: Write CLI RED tests**

Spawn the CLI in a temporary read-only fixture:

- `--plan --format=json` returns 99 unique cells and 99 signer blockers;
- `--check --format=json` succeeds with explicit gaps and reports zero trusted bundles;
- both modes leave a before/after recursive directory digest unchanged;
- `--execute` without an available signer/production nonce authority exits nonzero
  with `seam_receipt_signer_missing`;
- conflicting modes, unknown args, main/prod resource values and missing grant fail.

- [ ] **Step 2: Run RED**

Expected: CLI missing.

- [ ] **Step 3: Implement CLI**

The production adapter registry is empty in Phase 5. `--plan` and `--check` only
read the root contract and configured bundle references. `--execute` parses one
cell/grant but blocks before effect because every root descriptor lacks a signer
and there is no production nonce consumer.

Update the Phase 4 check script to run drill contract validation and include
`drill_cells=99`, signer blockers and trusted-bundle count in JSON/Markdown.

- [ ] **Step 4: Generate deterministic signer handoff**

Generate one section for each of the 11 seams containing:

- owner and `seam_ref`;
- adapter file name;
- required effect service identity/key purpose;
- normal/violation/recovery expected outcomes;
- isolation resource;
- minimal signer integration contract;
- current blocker.

The report must state that no signer, key or receipt was created.

- [ ] **Step 5: Run GREEN and commit**

Run CLI tests, `--plan`, `--check`, and Phase 4 report drift check. Commit.

### Task 6: Version, definitions, and final verification

**Files:**
- Modify: `packages/brain/package.json`
- Modify: `packages/brain/package-lock.json`
- Modify: `package-lock.json`
- Modify: `.brain-versions`
- Modify: `packages/brain/DEFINITION.md`
- Modify: `DEFINITION.md`

- [ ] **Step 1: Bump Brain to 1.268.7**

Document signed proof hardening, 99-cell plan, zero-write modes, all-real-execute
blocked state and rollback `1.268.6`.

- [ ] **Step 2: Run required verification**

Run:

```bash
cd packages/brain
npx vitest run \
  src/lib/__tests__/kernel-equivalence-drills.test.js \
  src/lib/__tests__/kernel-equivalence-receipts.test.js \
  src/lib/__tests__/kernel-equivalence-receipt-resolver.test.js \
  src/lib/__tests__/kernel-behavior-equivalence.test.js

cd ../../packages/quality
npx vitest run __tests__/regression-contract.test.js

cd ../..
node scripts/ci/run-kernel-equivalence-drill.mjs --plan --format=json
node scripts/ci/run-kernel-equivalence-drill.mjs --check --format=json
node scripts/ci/check-kernel-behavior-equivalence.mjs --check-report
bash scripts/check-version-sync.sh
git diff --check 884524ac0eaf5e87a7598ac0422e10fa90f78c1a..HEAD
git status --short
```

Expected: all tests/checks exit 0, plan reports exactly 99 cells, check reports
99 signer blockers and zero verified real bundles, worktree clean.

- [ ] **Step 3: Security audit**

Confirm with read-only searches:

- no private key, fake root public key or receipt artifact committed;
- no `behavior_ledger` table/migration;
- no production adapter, nonce consumer or main/prod enablement;
- no unit/static command accepted as proof;
- no ReleaseRun/risk production control-flow file changed.

- [ ] **Step 4: Commit and hand off**

Commit version/docs. Report base/head, ordered commits, test evidence, and the
11-seam real-environment signer execution backlog.
