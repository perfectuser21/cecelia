import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const smokeSource = readFileSync(
  new URL('../../scripts/smoke/unified-work-router-smoke.mjs', import.meta.url),
  'utf8',
);
const dispatchSmokeSource = readFileSync(
  new URL('../../scripts/smoke/unified-work-router-dispatch-smoke.mjs', import.meta.url),
  'utf8',
);
const completeSmokeSource = `${smokeSource}\n${dispatchSmokeSource}`;
const intentSource = readFileSync(
  new URL('../intent.js', import.meta.url),
  'utf8',
);
const historyVerifierSource = readFileSync(
  new URL('../../scripts/verify-unified-work-router-tdd-history.mjs', import.meta.url),
  'utf8',
);

describe('Unified Work Router scratch smoke contract', () => {
  it('保留 scratch、Map 刷新和三个真实入口合同', () => {
    const shellSource = readFileSync(
      new URL('../../scripts/smoke/unified-work-router-smoke.sh', import.meta.url),
      'utf8',
    );
    expect(shellSource).toContain('_scratch');
    expect(shellSource).toContain('map-fact-snapshot-smoke.sh');
    expect(shellSource).toContain('unified-work-router-smoke.mjs');
    expect(shellSource).toContain('unified-work-router-real-runner-smoke.mjs');
    expect(shellSource).toContain('CECELIA_REAL_RUNNER_IMAGE');
    expect(shellSource).toContain('DB_NAME=');
    expect(shellSource).toContain('schema_version');
    expect(shellSource).toContain('422');
    expect(smokeSource).toContain('routes/task-tasks.js');
    expect(smokeSource).toContain('parseAndCreate');
    expect(smokeSource).toContain('routes/capture-atoms.js');
    expect(smokeSource).toContain('work_routing_receipts');
    expect(smokeSource).toContain('harness_impact_contracts');
    expect(smokeSource).toContain('legacy_exempt');
  });

  it('必须经过真实 Dispatcher、Attempt Store 与 Runner 动作闸门', () => {
    expect(completeSmokeSource).toContain('createAttemptStore');
    expect(completeSmokeSource).toContain('createDispatcher');
    expect(completeSmokeSource).toContain('createDetachedLauncher');
    expect(completeSmokeSource).toContain('dispatchSmokeKernelAttempt');
    expect(completeSmokeSource).toContain('harness_attempts');
    expect(completeSmokeSource).toContain('install_routing_action_gate');
  });

  it('把 BASELINE_SHA 当实现基线校验，而不是伪装成当前 Map revision', () => {
    expect(smokeSource).toContain('process.env.BASELINE_SHA');
    expect(completeSmokeSource).toContain('merge-base');
    expect(smokeSource).toContain('sourceRevision');
  });

  it('Intent 入口把批准分支绑定到每个不可变 Routing Receipt', () => {
    expect(smokeSource).toMatch(/parseAndCreate[\s\S]*?branch,/);
    expect(intentSource).toContain('branch: options.branch');
  });

  it('TDD 账本以候选 ancestry 为证据且运行期基线来自参数', () => {
    expect(historyVerifierSource).toContain("['log', '--format=%H%x09%s', head]");
    expect(historyVerifierSource).not.toContain('BASELINE_SHA=310ab9e704d4e3f866e6ce7beb25b79dd0f9d524');
  });

  it('真实 Runner smoke 优先复用当前 Codex 容器的 attempt-scoped credential', () => {
    const shellSource = readFileSync(
      new URL('../../scripts/smoke/unified-work-router-smoke.sh', import.meta.url),
      'utf8',
    );
    const currentAttemptAuth = shellSource.indexOf('$HOME/.codex/auth.json');
    const legacyTeamAuth = shellSource.indexOf('$HOME/.codex-team1/auth.json');
    expect(currentAttemptAuth).toBeGreaterThan(-1);
    expect(legacyTeamAuth).toBeGreaterThan(currentAttemptAuth);
  });
});
