import { afterEach, describe, expect, it } from 'vitest';
import {
  mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve('.');
const CLI = path.join(ROOT, 'scripts/extract-contract-e2e.cjs');
const SKILL = path.join(
  ROOT,
  'packages/workflows/skills/harness-evaluator/SKILL.md',
);
const fixtures: string[] = [];

function runExtractor(content?: string) {
  const dir = mkdtempSync(path.join(tmpdir(), 'contract-e2e-cli-'));
  fixtures.push(dir);
  const contract = path.join(dir, 'contract-draft.md');
  if (content !== undefined) writeFileSync(contract, content);
  return spawnSync(process.execPath, [CLI, contract], {
    cwd: ROOT,
    encoding: 'utf8',
  });
}

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    rmSync(fixture, { recursive: true, force: true });
  }
});

describe('extract-contract-e2e CLI', () => {
  it('concatenates every bash fence in one recognized section in order', () => {
    const result = runExtractor([
      '# Contract',
      '',
      '### E2E 验收 — full',
      '',
      '```bash',
      'echo first',
      '```',
      '',
      '```bash',
      'echo second',
      '```',
      '',
      '## Test Contract',
      '',
      '```bash',
      'echo outside',
      '```',
      '',
    ].join('\n'));

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe('echo first\necho second\n');
  });

  it('keeps H3 subsections inside E2E and continues extracting later blocks', () => {
    const result = runExtractor([
      '# Contract',
      '',
      '## E2E 验收',
      '',
      '```bash',
      'echo first',
      '```',
      '',
      '### Step 2',
      '',
      '```bash',
      'echo second',
      '```',
      '',
      '## Test Contract',
      '',
    ].join('\n'));

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('echo first\necho second\n');
  });

  it.each([
    [
      'ambiguous E2E sections',
      '### E2E 验收\n```bash\necho first\n```\n## E2E 验收\n```bash\necho second\n```\n',
    ],
    [
      'an inline pseudo-heading',
      'paragraph ## E2E 验收\n```bash\necho inline\n```\n',
    ],
    [
      'an empty E2E script',
      '## E2E 验收\n```bash\n \t\n```\n',
    ],
  ])('fails nonzero on %s', (_label, content) => {
    const result = runExtractor(content);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('E2E extraction failed');
  });

  it('fails nonzero when the contract file is missing', () => {
    const result = runExtractor();
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('E2E extraction failed');
  });
});

describe('harness-evaluator Step B-1', () => {
  it('uses the shared CLI in the non-Windows branch and retires its bash AWK', () => {
    const skill = readFileSync(SKILL, 'utf8');
    const nonWindows = skill.match(
      /else\n  # 自包含 runtime[\s\S]*?  chmod \+x \/tmp\/e2e-verify\.sh/,
    )?.[0];

    expect(nonWindows).toBeDefined();
    expect(nonWindows).toContain(
      'node "/tmp/cecelia-extract-contract-e2e.cjs" "$CONTRACT" > /tmp/e2e-verify.sh',
    );
    expect(nonWindows).not.toMatch(/awk [^\n]*```bash/);
    expect(skill).toContain('version: 1.32.1');
    expect(skill).toContain('- 1.32.1:');
  });

  it('bundles the canonical extractor byte-for-byte for a third-party workspace', () => {
    const skill = readFileSync(SKILL, 'utf8');
    const canonical = readFileSync(CLI, 'utf8');
    const payload = skill.match(
      /<<'CECELIA_E2E_EXTRACTOR'\n([\s\S]*?)(?=^CECELIA_E2E_EXTRACTOR$)/m,
    )?.[1];

    expect(payload).toBeDefined();
    expect(payload).toBe(canonical);
    expect(skill).not.toContain(
      '$WORKSPACE/scripts/extract-contract-e2e.cjs',
    );

    const thirdParty = mkdtempSync(path.join(tmpdir(), 'third-party-evaluator-'));
    fixtures.push(thirdParty);
    const embeddedCli = path.join(thirdParty, 'cecelia-extract-contract-e2e.cjs');
    const contract = path.join(thirdParty, 'contract-draft.md');
    writeFileSync(embeddedCli, payload!);
    writeFileSync(
      contract,
      '## E2E 验收\n```bash\necho third-party\n```\n',
    );

    const result = spawnSync(process.execPath, [embeddedCli, contract], {
      cwd: thirdParty,
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe('echo third-party\n');
  });
});
