import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../routes/execution.js', import.meta.url), 'utf8');
const repoFile = (path) => readFileSync(
  new URL(`../../../../${path}`, import.meta.url),
  'utf8',
);

describe('legacy harness execution callback merge firewall', () => {
  it('cannot merge, force-push, deploy, or report directly from Evaluator PASS', () => {
    expect(source).not.toContain('gh pr merge');
    expect(source).not.toContain('git push -f');
    expect(source).not.toContain('scripts/post-merge-deploy.sh');
    expect(source).toContain('merge_authorization_required');
    expect(source).toContain("task_type: 'harness_intervention'");
  });

  it.each([
    '.github/workflows/ci.yml',
    'packages/quality/hooks/stop.sh',
    'packages/quality/hooks/post-pr-create.sh',
    'packages/brain/src/harness-promote-regression.js',
  ])('%s cannot retain an executable legacy merge path', (path) => {
    expect(repoFile(path)).not.toMatch(/\bgh\s+pr\s+merge\b/);
    expect(repoFile(path)).not.toMatch(/\[\s*['"]pr['"]\s*,\s*['"]merge['"]/);
  });

  it('Claude Bash guard rejects direct gh pr merge commands', () => {
    const guard = repoFile('packages/engine/hooks/bash-guard.sh');
    expect(guard).toContain('MERGE AUTHORITY');
    expect(guard).toContain('MERGE_COMMAND_PATTERN');
    expect(guard).toContain('gh[[:space:]]+pr[[:space:]]+merge');
  });
});
