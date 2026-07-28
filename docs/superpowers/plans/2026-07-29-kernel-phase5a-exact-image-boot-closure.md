# Kernel Phase 5A Exact-Image Boot Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Phase 5A exact Brain Docker image contain its complete
Brain/Engine runtime graph, carry an exact Git SHA, and prove bounded real
server startup without weakening the ACL/xattr contract.

**Architecture:** `/app` remains the sole Brain source tree and `/brain` is an
immutable symlink to it; the complete Engine package is copied to `/engine`.
A Docker-backed contract validates identity, boot-graph imports, isolated
PostgreSQL startup, HTTP health, and zero cleanup residue.

**Tech Stack:** Docker/BuildKit, Node.js ESM, Vitest, PostgreSQL/pgvector,
GitHub Actions.

---

### Task 1: RED source and CLI contracts

**Files:**
- Create: `packages/brain/src/__tests__/kernel-brain-runtime-image-contract.test.js`
- Create: `packages/brain/src/__tests__/kernel-brain-runtime-image-cli.test.js`

- [ ] Write a source contract requiring full `/engine`, `/brain -> /app`,
      exact CI `GIT_SHA`, runtime-contract invocation, and change detection.
- [ ] Write CLI parser/runner tests for exact SHA validation, explicit Docker
      absence behavior, bounded health polling, and cleanup residue failure.
- [ ] Run both tests and confirm they fail because the runtime contract and
      Docker layout do not exist.
- [ ] Commit the RED tests without production changes.

### Task 2: GREEN immutable runtime graph

**Files:**
- Modify: `packages/brain/Dockerfile`
- Create: `scripts/ci/brain-runtime-image-contract.mjs`
- Modify: `.github/workflows/ci.yml`

- [ ] Add `/brain -> /app` and copy the complete Engine package to `/engine`.
- [ ] Implement exact image identity and module-graph probes.
- [ ] Implement bounded isolated PostgreSQL + Brain startup, health polling,
      and `finally` cleanup with residue verification.
- [ ] Pass `${GITHUB_SHA}` into the Docker build and runtime contract.
- [ ] Run the two RED suites and confirm GREEN.

### Task 3: Exact-image and cross-import verification

**Files:**
- Verify: `packages/brain/Dockerfile`
- Verify: `scripts/ci/brain-runtime-image-contract.mjs`
- Verify: `scripts/ci/kernel-protected-filesystem-image-contract.mjs`

- [ ] Build a fresh image with the exact candidate SHA and no cached tag
      ambiguity.
- [ ] Run the new runtime contract and observe exact SHA, graph import, real
      health, and zero-residue passes.
- [ ] Run the existing ACL/xattr image contract unchanged.
- [ ] Inspect `/app/scripts/fleet-worker` CommonJS dependencies and production
      seam secondary imports from inside the exact image.

### Task 4: Definition, version, and full verification

**Files:**
- Modify: `.brain-versions`
- Modify: `DEFINITION.md`
- Modify: `packages/brain/DEFINITION.md`
- Modify: `packages/brain/package.json`
- Modify: `packages/brain/package-lock.json`
- Modify: `package-lock.json`

- [ ] Bump the isolated Phase5A closure version to `1.268.24`.
- [ ] Document the exact-image boot closure and rollback boundary.
- [ ] Run focused Phase5A, runtime-contract, Docker, syntax, diff, secret,
      facts, version, manifest, and local precheck verification.
- [ ] Review the exact diff for unrelated changes and commit the GREEN
      implementation locally without push, PR, merge, or deployment.
