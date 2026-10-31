import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const runner = readFileSync(
  new URL('../../../../../docker/cecelia-runner/entrypoint.sh', import.meta.url),
  'utf8',
);

describe('harness-evaluator Impact Contract assertion receipts', () => {
  it('required_assertions 由可信 Runner 逐项执行并输出可机械验真的 checks', () => {
    expect(runner).toContain('merge_required_assertion_evidence');
    expect(runner).toContain('assertion-exec.mjs');
    expect(runner).not.toContain('bash -lc "$assertion_command"');
    expect(runner).toContain('runner_evidence_sha256');
    expect(runner).toContain('command_argv:$command_argv');
    expect(runner).toContain('scenario_evidence:{pr_head_sha:$pr_head_sha, machine:$machine');
    expect(runner).toContain('required assertion workspace HEAD does not match PR head');
    expect(runner).toContain('.decision.outcome = "FAIL"');
  });
});
