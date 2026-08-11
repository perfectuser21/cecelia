import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const skill = readFileSync(
  new URL('../../../../../packages/workflows/skills/harness-evaluator/SKILL.md', import.meta.url),
  'utf8',
);
const runner = readFileSync(
  new URL('../../../../../docker/cecelia-runner/entrypoint.sh', import.meta.url),
  'utf8',
);

describe('harness-evaluator Impact Contract assertion receipts', () => {
  it('required_assertions 由可信 Runner 逐项执行并输出可机械验真的 checks', () => {
    expect(skill).toContain('required_assertions');
    expect(skill).toContain('Harness Runner');
    expect(skill).not.toContain('required-assertions-executor:start');
    expect(runner).toContain('merge_required_assertion_evidence');
    expect(runner).toContain('bash -lc "$assertion_command"');
    expect(runner).toContain('runner_evidence_sha256');
    expect(runner).toContain('command_argv:["bash", "-lc", $command]');
    expect(runner).toContain('scenario_evidence:{pr_head_sha:$pr_head_sha, machine:$machine');
    expect(runner).toContain('required assertion workspace HEAD does not match PR head');
    expect(runner).toContain('.decision.outcome = "FAIL"');
  });

  it('最终 writer 是合法 bash', () => {
    const start = '# evaluator-result-writer:start';
    const end = '# evaluator-result-writer:end';
    const block = skill.slice(skill.indexOf(start), skill.indexOf(end) + end.length);
    expect(block).toContain(start);
    expect(spawnSync('bash', ['-n'], { input: block, encoding: 'utf8' })).toMatchObject({
      status: 0,
      stderr: '',
    });
  });
});
