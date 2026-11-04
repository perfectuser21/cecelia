import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export function writeContract(
  fixtureRoot: string,
  sprint: string,
  testFiles: string[],
  filename = 'contract-draft.md',
): void {
  const sprintDir = path.join(fixtureRoot, 'sprints', sprint);
  mkdirSync(sprintDir, { recursive: true });
  const rows = testFiles.map(
    (testFile, index) =>
      `| WS${index + 1} | \`${testFile}\` | B-${index + 1} | expected red |`,
  );
  writeFileSync(
    path.join(sprintDir, filename),
    [
      '# Contract',
      '',
      '## Test Contract',
      '',
      '| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |',
      '|---|---|---|---|',
      ...rows,
      '',
    ].join('\n'),
  );
}

export function prepareGuardFixture(fixture: string): void {
  mkdirSync(path.join(fixture, 'scripts/smoke'), { recursive: true });
  mkdirSync(path.join(fixture, 'perm/unit'), { recursive: true });
  writeFileSync(path.join(fixture, 'perm/unit/x.test.js'), '');
}

export function writeE2EContract(
  fixtureRoot: string,
  sprint: string,
  section: string,
  filename = 'contract-draft.md',
): void {
  const sprintDir = path.join(fixtureRoot, 'sprints', sprint);
  mkdirSync(sprintDir, { recursive: true });
  writeFileSync(
    path.join(sprintDir, filename),
    ['# Contract', '', section, '', '## Test Contract', ''].join('\n'),
  );
}
