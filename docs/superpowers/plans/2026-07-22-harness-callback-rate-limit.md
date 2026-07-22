# Harness Attempt Callback Rate Limit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clear the two CodeQL `Missing rate limiting` alerts without throttling legitimate runner heartbeats or idempotent terminal callbacks.

**Architecture:** Attach two independent `express-rate-limit` middleware instances before the heartbeat and terminal callback handlers. Key each store by the high-entropy `attemptId`, count only failed responses, and keep the existing authentication, lease fencing, persistence, and deduplication handlers unchanged.

**Tech Stack:** Node.js ESM, Express 4, express-rate-limit 8, Vitest, Supertest

---

### Task 1: Prove both callback routes are currently unbounded

**Files:**
- Modify: `packages/brain/src/routes/__tests__/harness-attempt-callback.test.js`

- [ ] **Step 1: Add terminal callback failure-budget test**

Append a test that sends eleven callbacks with a wrong bearer token. Assert the first ten are `401`, the eleventh is `429`, and only ten requests reach `attemptStore.getById`.

- [ ] **Step 2: Add heartbeat failure-budget test**

Append a test that sends thirty-one heartbeats without a bearer token. Assert the first thirty are `401`, the thirty-first is `429`, and only thirty requests reach `attemptStore.getById`.

- [ ] **Step 3: Run the new tests and confirm RED**

Run:

```bash
cd packages/brain
npx vitest run src/routes/__tests__/harness-attempt-callback.test.js
```

Expected: both new assertions fail because every request still enters the handler and returns `401`.

### Task 2: Add scoped middleware and make the tests green

**Files:**
- Modify: `packages/brain/package.json`
- Modify: `packages/brain/package-lock.json`
- Modify: `packages/brain/src/routes/harness-callback.js`
- Test: `packages/brain/src/routes/__tests__/harness-attempt-callback.test.js`

- [ ] **Step 1: Install the supported middleware**

Run:

```bash
cd packages/brain
npm install express-rate-limit@^8.6.0
```

Expected: `express-rate-limit` appears in dependencies and the Brain lockfile records the package.

- [ ] **Step 2: Define two independent limiters**

Import `rateLimit` and construct heartbeat/terminal middleware with `windowMs: 60_000`, limits `30` and `10`, `keyGenerator: req => req.params.attemptId`, `skipSuccessfulRequests: true`, `standardHeaders: 'draft-7'`, `legacyHeaders: false`, and a JSON 429 body.

- [ ] **Step 3: Attach middleware before database access**

Change both route declarations to the three-argument Express form:

```js
router.post('/harness/attempts/:attemptId/heartbeat', heartbeatRateLimit, async (req, res) => {
router.post('/harness/attempts/:attemptId/callback', callbackRateLimit, async (req, res) => {
```

- [ ] **Step 4: Run the route tests and confirm GREEN**

Run:

```bash
cd packages/brain
npx vitest run src/routes/__tests__/harness-attempt-callback.test.js
```

Expected: all tests pass; blocked requests return `429` before `getById`.

- [ ] **Step 5: Commit the behavioral fix**

```bash
git add packages/brain/package.json packages/brain/package-lock.json packages/brain/src/routes/harness-callback.js packages/brain/src/routes/__tests__/harness-attempt-callback.test.js
git commit -m "fix(harness): rate limit attempt callbacks"
```

### Task 3: Version, verify, publish, and recheck CodeQL

**Files:**
- Modify: `.brain-versions`
- Modify: `DEFINITION.md`
- Modify: `package-lock.json`
- Modify: `packages/brain/package.json`
- Modify: `packages/brain/package-lock.json`

- [ ] **Step 1: Bump Brain from 1.267.34 to 1.267.35**

Update all five version references required by the repository version-sync gate.

- [ ] **Step 2: Run full local verification**

Run the 28-file/432-test harness set, `facts-check.mjs`, version sync, DoD mapping, provider-neutral smoke, syntax checks, and `git diff --check`.

Expected: zero failures.

- [ ] **Step 3: Commit and push**

```bash
git add .brain-versions DEFINITION.md package-lock.json packages/brain/package.json packages/brain/package-lock.json docs/superpowers/plans/2026-07-22-harness-callback-rate-limit.md
git commit -m "chore(brain): bump callback hardening to 1.267.35"
git push
```

- [ ] **Step 4: Recheck PR #4186**

Run `gh pr checks 4186 --watch` and inspect any remaining failure annotations. Success means both CodeQL alerts disappear and all required checks are green.
