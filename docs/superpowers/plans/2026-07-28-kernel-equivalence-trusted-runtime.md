# Kernel Equivalence Trusted Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development and execute each task through an observed RED, minimal GREEN, and focused regression run. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Phase 5 drill runner's injected-only authorities with production-grade signer, PostgreSQL durability, registry, and CLI wiring components while keeping the root contract at zero keys, zero proven cells, and 99 blockers.

**Architecture:** Private Ed25519 material is loaded only through protected regular-file descriptors and retained in closure-scoped `KeyObject`s; the grant authority and collector are separate factories so the execute process never needs grant-signing authority. PostgreSQL owns nonce replay prevention, denial audits, the append-only bundle ledger, its compare-and-swap head, and recovery predecessor lookup. Adapter and cleanup implementations remain server-owned registries with no production entries in this change, so configured execution fails closed until each of the eleven real seam deployments exists.

**Tech Stack:** Node.js ESM, Node `crypto`/`fs`, PostgreSQL transactions and JSONB, `pg`, Vitest, root `regression-contract.yaml`.

---

## File map

- `packages/brain/src/lib/kernel-equivalence-signers.js`: protected Ed25519 key-file loading, registry/lifecycle binding, grant authority, and collector signer.
- `packages/brain/src/lib/kernel-equivalence-runtime-registry.js`: immutable server-owned adapter and independent cleanup-verifier contracts.
- `packages/brain/src/lib/kernel-equivalence-postgres-runtime.js`: atomic nonce consumer, trusted audit sink, CAS bundle-chain store/readback, and recovery predecessor resolver.
- `packages/brain/src/lib/kernel-equivalence-runtime-loader.js`: fail-closed environment-metadata and PostgreSQL wiring composition.
- `scripts/ci/run-kernel-equivalence-drill.mjs`: opt-in trusted `--execute` path; unconfigured operation retains the current explicit blocker.
- `packages/brain/migrations/375_kernel_equivalence_runtime.sql`: provisional post-ReleaseRun runtime schema; integration must land after migration `374` and may renumber this file.
- Focused unit, adversarial, migration, CLI, and real-PostgreSQL tests live beside the existing equivalence suites.

### Task 1: Protected Ed25519 signer authorities

- [ ] Add failing tests that reject relative paths, symlinks, directories, hard links, wrong owner, group/world-readable files, oversized/empty files, malformed/non-Ed25519 keys, metadata mismatch, inactive/revoked keys, and private-key/public-registry mismatch.
- [ ] Run the signer test and confirm RED due to the missing module.
- [ ] Implement a bounded `O_RDONLY | O_NOFOLLOW` loader that checks `fstat` regular-file identity, link count, portable effective ownership, and mode `0400|0600`; import the private key and compare its derived public key to the active public registry record.
- [ ] Implement a server-only execution-grant authority that creates exact-schema, isolated, short-lived signed grants and a separate collector signer that signs `assembleUnsignedBundle()` output. Neither returned object exposes a private key, source path, signature input, or raw secret through JSON.
- [ ] Run focused signer and existing receipt tests; commit RED then GREEN atomically.

### Task 2: Server-owned adapter and cleanup registries

- [ ] Add failing tests for duplicate IDs, unknown IDs, incomplete adapter lifecycle methods, adapter-owned cleanup verification, mutable registration, and malformed verifier results.
- [ ] Implement immutable registry constructors. Adapter resolution returns only pre-registered server objects; cleanup verification is delegated to a separately registered verifier identity and only returns a bounded `{ confirmed, evidence_ref }` result.
- [ ] Run focused tests; commit RED then GREEN.

### Task 3: Provisional migration and PostgreSQL authorities

- [ ] Add a migration contract test requiring nonce uniqueness, immutable nonce/audit/bundle rows, a mutable singleton chain head, exact hash/axis constraints, indexes for predecessor lookup, and schema-version registration. Assert the migration documents its integration dependency on ReleaseRun migration `374`.
- [ ] Add failing store tests against query/client doubles for one-statement nonce consumption, allowlisted audit insertion, transactional CAS, rollback on lost head race, canonical bundle hash/readback checks, and exact unique violation predecessor lookup.
- [ ] Add `375_kernel_equivalence_runtime.sql` and implement PostgreSQL factories with strict input validation and stable error codes.
- [ ] Run migration/store tests; commit RED then GREEN.

### Task 4: Real PostgreSQL concurrency and append-only proof

- [ ] Add an integration test that applies migration `375` twice in an isolated schema, races two consumers for one nonce, races two commits from one chain head, reads the winner back, resolves a violation predecessor, and proves UPDATE/DELETE triggers reject nonce/audit/bundle mutations.
- [ ] Run against the local test PostgreSQL when available and confirm initial RED.
- [ ] Adjust only production SQL/store behavior needed for atomicity and readback; keep the integration suite green.
- [ ] Commit RED then GREEN.

### Task 5: Fail-closed runtime loader and CLI execution

- [ ] Add loader tests proving raw private-key environment values are rejected, all metadata/path fields are mandatory, unavailable DB/registry/collector/audit/predecessor/cleanup dependencies fail closed, and no error/result includes env values or key material.
- [ ] Add CLI RED tests: the unconfigured root command remains write-free and explicitly unavailable; opt-in configuration invokes the trusted loader; incomplete configuration returns only stable wiring codes; plan/check remain read-only and continue reporting zero keys, zero trusted bundles, eleven gaps, and 99 blockers.
- [ ] Implement an exact opt-in flag and environment-metadata parser, use the shared Brain PostgreSQL pool only after configuration passes, load the signed grant from a protected regular file, compose the trusted runtime, and call `executeDrillCell`.
- [ ] Do not add any adapter, cleanup verifier, public key, private key, proof bundle, or fake seam effect. Root execution therefore still fails before effects.
- [ ] Run loader/CLI/all equivalence tests; commit RED then GREEN.

### Task 6: Definitions, deployment handoff, and verification

- [ ] Bump Brain to `1.268.8` in all version surfaces and update both definitions with rollback `1.268.7`.
- [ ] Update the signer/adapter handoff with the runtime environment metadata, migration dependency, and exact eleven remaining adapter/signer/cleanup-verifier deployment gaps without changing proof counts.
- [ ] Run focused unit and real-PostgreSQL suites, quality contract tests, plan/check commands, version sync, `git diff --check`, and secret scans.
- [ ] Confirm no private/synthetic key, receipt, proof status, ReleaseRun control-flow edit, push, PR, merge, or deployment occurred; commit documentation/version changes.
