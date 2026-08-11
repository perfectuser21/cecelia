# Universal Map Knife 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将旧账本的稳定锚点、四类事实快照与 revision-bound receipt 接入 active projection，并在查询时现算状态和影响半径。

**Architecture:** `map_scope_repositories` 只保存 scope 到 repo adapter 的稳定配置。Anchor Resolver 通过 `journeys.capability_code` 和 feature UUID 精确归属，通过 registry path/stable identifier 精确命中事实；禁止名称 `ILIKE` 或 scope=repo 猜测。State Resolver 只读 active projection、snapshot header 和当前 revision receipt，不写颜色。

**Tech Stack:** Node.js ESM, PostgreSQL 15, Vitest, Bash smoke, existing migrations/projector/store.

---

### Task 1: Repo adapter contract

**Files:**
- Create: `packages/brain/migrations/406_map_scope_repositories.sql`
- Create: `packages/brain/migrations/rollback/406_map_scope_repositories.down.sql`
- Create: `packages/brain/src/lib/map-repo-adapter.js`
- Test: `packages/brain/src/lib/__tests__/map-repo-adapter.test.js`
- Test: `packages/brain/src/__tests__/migration-406-map-scope-repositories.test.js`

- [ ] Write RED tests proving explicit `cecelia -> cecelia`, stable ordering, unknown scope rejection, and no `scope_key === repo` fallback.
- [ ] Run `npx vitest run src/lib/__tests__/map-repo-adapter.test.js src/__tests__/migration-406-map-scope-repositories.test.js`; expect missing-module/migration failures.
- [ ] Add the additive table with `(scope_key, repo)` primary key and a generic adapter loader.
- [ ] Re-run the two files; expect all pass.
- [ ] Commit `test(brain): define map repo adapter contract` then `feat(brain): add explicit map repo adapters`.

### Task 2: Deterministic Anchor Resolver

**Files:**
- Create: `packages/brain/src/lib/map-anchor-resolver.js`
- Test: `packages/brain/src/lib/__tests__/map-anchor-resolver.test.js`
- Modify: `packages/brain/src/lib/map-projector.js`
- Modify: `packages/brain/src/lib/map-projection-store.js`
- Test: `packages/brain/src/lib/__tests__/map-projector.test.js`
- Test: `packages/brain/src/__tests__/integration/map-projection-store.integration.test.js`

- [ ] Write RED tests for exact `capability_code`, feature UUID identity, exact test/API/DB/path matching, ambiguous anchors, missing targets, and artifact/feature/assertion stable IDs.
- [ ] Run the four targeted files; expect missing resolver and missing artifact edges.
- [ ] Implement `loadAnchorFacts(client,{scopeKey,repos})` and pure `resolveMapAnchors(input)` returning deterministic nodes/edges/evidence; reject name regex matching.
- [ ] Extend projector input with resolved anchor projection and include `feature/artifact/assertion` plus `implements/proves/affects` in canonical digest.
- [ ] Re-run targeted tests and real `cecelia_test` integration; expect atomic active run and stable digest.
- [ ] Commit RED then GREEN separately.

### Task 3: Query-time State Resolver

**Files:**
- Create: `packages/brain/src/lib/map-state-resolver.js`
- Test: `packages/brain/src/lib/__tests__/map-state-resolver.test.js`
- Test: `packages/brain/src/__tests__/integration/map-state-resolver.integration.test.js`

- [ ] Write RED matrix for `green/red/gray/unknown/not_applicable`, 15-minute header freshness, missing/invalid revision, target disappearance, latest current-revision receipt, and aggregate precedence.
- [ ] Run both files; expect missing module.
- [ ] Implement pure `resolveEvidenceState()` and batched PostgreSQL reader; PASS/FAIL contributes only when `receipt.source_sha === snapshot.source_revision`.
- [ ] Prove legacy `cell_status=green` is ignored and stale facts can never return green.
- [ ] Re-run unit/integration tests; expect all pass.
- [ ] Commit RED then GREEN separately.

### Task 4: Impact radius

**Files:**
- Create: `packages/brain/src/lib/map-impact-radius.js`
- Test: `packages/brain/src/lib/__tests__/map-impact-radius.test.js`
- Test: `packages/brain/src/__tests__/integration/map-impact-radius.integration.test.js`

- [ ] Write RED tests for changed file graph traversal, business-node backtracking, must-run assertions, crosscut serves expansion, and deterministic ordering.
- [ ] Implement bounded graph traversal over the selected repo snapshot and active projection edges.
- [ ] Re-run unit/integration tests; expect non-empty crosscut radius and exact repo isolation.
- [ ] Commit RED then GREEN separately.

### Task 5: Proven-to-fire scratch drill

**Files:**
- Create: `packages/brain/scripts/smoke/map-anchor-state-smoke.sh`
- Modify: `packages/quality/smoke-allowlist.txt`
- Create: `sprints/08111325-universal-map-knife3/contract-draft.md`
- Create: `sprints/08111325-universal-map-knife3/contract-dod.md`

- [ ] Write smoke RED against `cecelia_scratch`: current PASS=green, delete test+rescan=gray, current FAIL=red, stale header=unknown, then restore all fixtures.
- [ ] Run migration 406 and the smoke only on `cecelia_scratch`; expect RED before wiring and GREEN after implementation.
- [ ] Run targeted suite, three DevGate commands, DoD mapping, smoke ratchet, full Brain suite, and `git diff --check`.
- [ ] Bump Brain patch version and schema floor consistently.
- [ ] Commit, request review, push PR, wait CI, merge normally, and verify production rebuild without direct production schema mutation.
