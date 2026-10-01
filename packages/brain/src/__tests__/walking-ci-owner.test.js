import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import { spawnSync } from 'node:child_process';

const workflow = yaml.load(readFileSync(new URL('../../../../.github/workflows/ci.yml', import.meta.url), 'utf8'));
describe('Walking actual CI owner and PG acceptance', () => {
  it('required owner has its own safe URI, socket and prepared worker image', () => {
    const job = workflow.jobs['walking-ci-e2e'];
    expect(job).toBeDefined();
    const commands = job.steps.map(step => step.run || '').join('\n');
    expect(commands).toContain('DATABASE_URL'); expect(commands).toContain('/var/run/docker.sock');
    expect(commands).toContain('docker pull alpine'); expect(commands).toContain('WALKING_CI_OWNER=1');
    expect(commands).toContain('walking-skeleton-1node-smoke.sh');
    expect(workflow.jobs['ci-passed'].needs).toContain('walking-ci-e2e');
    expect(job.if).toBeUndefined();
    expect(commands).toContain('node --test packages/quality/tests/walking-checkpointer-guard.node-test.mjs');
  });
  it.each(['success', 'failure', 'cancelled', 'skipped', 'timed_out', '', 'unknown'])('actual aggregate strictly checks Walking result %j', result => {
    const gate = workflow.jobs['ci-passed'].steps.find(step => step.name === 'Check results').run;
    expect(gate).toContain('needs.walking-ci-e2e.result');
    const rendered = gate.replace(/\$\{\{ needs\.([\w-]+)\.result \}\}/g, (_, name) => name === 'walking-ci-e2e' ? result : 'success');
    expect(spawnSync('bash', ['-c', rendered]).status).toBe(result === 'success' ? 0 : 1);
  });
  it('legacy runner delegates Walking without counting a pass or skip', () => {
    const runner = workflow.jobs['real-env-smoke'].steps.find(step => step.name.startsWith('Run all')).run;
    expect(runner).toContain('walking-skeleton-1node-smoke.sh');
    expect(runner).toContain('DELEGATED'); expect(runner).toContain('walking-ci-e2e');
  });
  it('two tracked threads require actual PG interrupt, final graph state and unique completion event', () => {
    const source = readFileSync(new URL('../../scripts/smoke/walking-skeleton-1node-smoke.sh', import.meta.url), 'utf8');
    expect(source).not.toContain('检测 endpoint 部署');
    expect(source).toContain('walking-ci-pg-state.mjs');
    expect(source).toContain('waiting'); expect(source).toContain('completed');
    expect(source).toContain('docker restart "$CONTAINER"');
    expect(source).not.toContain('docker compose');
    expect(source).toContain('260');
  });
});
