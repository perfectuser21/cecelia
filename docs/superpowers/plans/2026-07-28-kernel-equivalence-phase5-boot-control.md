# Kernel Equivalence Phase 5 Boot Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development and execute each task through an observed RED, minimal GREEN, and focused regression run. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the existing production trusted-execution factory into Brain through a protected, pinned configuration boundary and add a separated crash-safe grant issuer/reader control plane.

**Architecture:** A protected JSON manifest supplies only public trust and protected-secret metadata. A production wiring loader pins the canonical plan and all configuration before constructing the existing one-shot service factory; server boot consumes only that outer loader. The grant issuer owns signed atomic writes and expiry cleanup while the reader owns only exact opaque reads.

**Tech Stack:** Node.js ESM, Node `fs`/`crypto`/Unix sockets, PostgreSQL pool capability, js-yaml, Vitest.

---

### Task 1: Protected grant issuer and expiry fence

- [ ] Add RED tests for issuer/reader separation, 0600 atomic publication,
      collision refusal, fsync sequence, expired read denial, safe cleanup, and
      unsafe/replaced file retention.
- [ ] Run the focused test and confirm the missing issuer behavior is RED.
- [ ] Implement the minimal issuer and add a pinned clock to the reader.
- [ ] Run the focused tests GREEN and commit.

### Task 2: Protected production manifest and canonical assembly

- [ ] Add RED tests for missing/bad config, raw env secrets, file safety,
      exact schema, canonical plan digest, registry/key mismatch, and immutable
      snapshots.
- [ ] Run focused tests and confirm RED.
- [ ] Implement protected manifest loading, plan compilation/key overlay, and
      production factory composition. Return
      `trusted_execution_ports_unconfigured` when outer ports are absent.
- [ ] Run focused factory/signer/assembly tests GREEN and commit.

### Task 3: Real server boot path

- [ ] Add a RED server-boot integration that supplies a protected complete
      manifest and plain minimal outer local ports but never injects an inner
      service, registry, or adapter.
- [ ] Assert incomplete configuration creates no socket with the exact
      readiness code.
- [ ] Implement `bootProductionBrainTrustedExecution()` and wire `server.js`
      to pass the shared pool.
- [ ] Assert the complete isolated path opens a mode-0600 UDS and closes it by
      exact inode. Run focused tests GREEN and commit.

### Task 4: Dynamic CLI readiness

- [ ] Add RED tests for unavailable, unsafe, and live mode-0600 socket
      readiness.
- [ ] Implement a shared read-only socket inspector and replace the CLI's
      constant wiring blocker list.
- [ ] Run CLI/client/socket regressions GREEN and commit.

### Task 5: Definition, version, and verification

- [ ] Update Brain/root version surfaces and `packages/brain/DEFINITION.md`.
- [ ] Run all focused and equivalence suites plus local PostgreSQL runtime
      integration.
- [ ] Run syntax, lint, version sync, local precheck, facts, `git diff
      --check`, and secret scans.
- [ ] Review the exact diff for P0/P1 security issues, commit, and report a
      clean exact SHA without claiming production readiness.
