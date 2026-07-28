import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../routes/execution.js', import.meta.url), 'utf8');

describe('legacy harness execution callback merge firewall', () => {
  it('cannot merge, force-push, deploy, or report directly from Evaluator PASS', () => {
    expect(source).not.toContain('gh pr merge');
    expect(source).not.toContain('git push -f');
    expect(source).not.toContain('scripts/post-merge-deploy.sh');
    expect(source).toContain('merge_authorization_required');
    expect(source).toContain("task_type: 'harness_intervention'");
  });
});
