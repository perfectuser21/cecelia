#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const baseline = process.argv[2];
const head = process.argv[3] || 'HEAD';
if (!/^[0-9a-f]{40}$/.test(baseline || '')) throw new Error('baseline_sha_required');
execFileSync('git', ['merge-base', '--is-ancestor', baseline, head], { stdio: 'inherit' });
if (execFileSync('git', ['rev-parse', head], { encoding: 'utf8' }).trim() === baseline) throw new Error('head_must_advance_baseline');

const pairs = [
  ['test(brain): reproduce harness worktree recovery failures', 'fix(brain): protect active harness worktrees and redact origins', "npx vitest run sprints/08121555-unified-work-router/tests/unified-work-router-contract.test.ts -t 'Unified Work Router Recovery RED' --reporter=verbose"],
  ['test(brain): define unified work routing contracts', 'feat(brain): add transactional unified work router', 'cd packages/brain && DB_URL="$DB_URL" npx vitest run src/__tests__/work-router.test.js src/__tests__/work-routing-entry.test.js src/__tests__/migration-411-work-routing.test.js src/__tests__/integration/work-routing-store.integration.test.js --reporter=verbose'],
  ['test(brain): expose legacy task creation routing defects', 'refactor(brain): route all executable task creation through one boundary', 'cd packages/brain && npx vitest run src/__tests__/task-creation-inventory.test.js src/__tests__/work-router-entrypoints.test.js src/routes/__tests__/capture-atoms-routing.test.js --reporter=verbose'],
  ['test(brain): require map governed harness preflight', 'feat(brain): enforce map governed four-form harness runs', 'cd packages/brain && DB_URL="$DB_URL" BASELINE_SHA=310ab9e704d4e3f866e6ce7beb25b79dd0f9d524 npx vitest run src/orchestrator/__tests__/change-kind-profiles.test.js src/orchestrator/preflight/map-impact-contract.test.js src/orchestrator/__tests__/map-recovery-contract.test.js --reporter=verbose'],
  ['test(engine): require routing receipt before mutation', 'feat(engine): enforce routing receipt at mutation time', 'bash packages/engine/tests/integration/dev-mode-routing-receipt-guard.test.sh'],
  ['test(harness): expose generator and dispatcher trust gaps', 'feat(harness): gate headless coding and generator capabilities', 'cd packages/brain && npx vitest run src/orchestrator/__tests__/dispatcher-routing-receipt.test.js --reporter=verbose && cd ../.. && bash docker/cecelia-runner/__tests__/entrypoint-generator-trust-boundary.test.sh'],
  ['test(brain): define unified router scratch acceptance', 'feat(cecelia): enforce unified work routing across all coding', 'DB_URL="$DB_URL" BASELINE_SHA=310ab9e704d4e3f866e6ce7beb25b79dd0f9d524 bash packages/brain/scripts/smoke/unified-work-router-smoke.sh && cd packages/brain && npx vitest run src/__tests__/work-routing-observability.test.js --reporter=verbose'],
];
const log = execFileSync('git', ['log', '--format=%H%x09%s', `${baseline}..${head}`], { encoding: 'utf8' })
  .trim().split('\n').map(line => line.split('\t'));
const rootNodeModules = resolve('node_modules');
for (const [redSubject, greenSubject, command] of pairs) {
  const red = log.find(([, subject]) => subject === redSubject)?.[0];
  const green = log.find(([, subject]) => subject === greenSubject)?.[0];
  if (!red || !green) throw new Error(`missing_tdd_pair:${redSubject}`);
  execFileSync('git', ['merge-base', '--is-ancestor', red, green], { stdio: 'inherit' });
  for (const [sha, expected] of [[red, 1], [green, 0]]) {
    const parent = mkdtempSync(join(tmpdir(), 'unified-router-tdd-'));
    const worktree = join(parent, 'repo');
    try {
      execFileSync('git', ['worktree', 'add', '--detach', worktree, sha], { stdio: 'ignore' });
      symlinkSync(rootNodeModules, join(worktree, 'node_modules'), 'dir');
      const result = spawnSync('bash', ['-c', command], { cwd: worktree, env: { ...process.env, DB_URL: process.env.DB_URL || '' }, stdio: 'ignore' });
      const succeeded = result.status === 0;
      if ((expected === 0) !== succeeded) throw new Error(`tdd_replay_mismatch:${sha}:${result.status}`);
    } finally {
      try { execFileSync('git', ['worktree', 'remove', '--force', worktree], { stdio: 'ignore' }); } catch {}
      rmSync(parent, { recursive: true, force: true });
    }
  }
}
console.log(`Unified Work Router TDD history PASS (${pairs.length}/${pairs.length})`);
