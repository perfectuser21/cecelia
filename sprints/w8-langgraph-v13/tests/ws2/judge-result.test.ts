import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  cpSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

const REPO_ROOT = resolve(__dirname, '../../../..');
const SCRIPT = resolve(REPO_ROOT, 'sprints/w8-langgraph-v13/scripts/judge-result.sh');
const FIX_PASS = resolve(__dirname, 'fixtures/pass');
const FIX_FAIL = resolve(__dirname, 'fixtures/fail');
const FIX_INCONCLUSIVE = resolve(__dirname, 'fixtures/inconclusive');
const FIX_BOOT_CROSS = resolve(__dirname, 'fixtures/boot-cross');

function makeSandbox(): { sprintDir: string; evidenceDir: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'w8v13-judge-'));
  const sprintDir = join(root, 'sprint');
  const evidenceDir = join(sprintDir, 'evidence');
  mkdirSync(evidenceDir, { recursive: true });
  return { sprintDir, evidenceDir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

describe('Workstream 2 — judge-result.sh [BEHAVIOR]', () => {
  it('script file exists and is executable', () => {
    expect(existsSync(SCRIPT)).toBe(true);
    expect(statSync(SCRIPT).mode & 0o111).not.toBe(0);
  });

  it('exits non-zero with usage when called with no args', () => {
    const r = spawnSync('bash', [SCRIPT], { encoding: 'utf8' });
    expect(r.status).not.toBe(0);
    expect((r.stderr || '') + (r.stdout || '')).toMatch(/usage|Usage|USAGE/);
  });

  it('writes result.md starting with PASS when given pass-fixture evidence', () => {
    const sb = makeSandbox();
    try {
      cpSync(FIX_PASS, sb.evidenceDir, { recursive: true });
      const r = spawnSync(
        'bash',
        [SCRIPT, '00000000-0000-0000-0000-000000000001', sb.evidenceDir, sb.sprintDir],
        { encoding: 'utf8' },
      );
      expect(r.status).toBe(0);
      const result = readFileSync(join(sb.sprintDir, 'result.md'), 'utf8');
      expect(result.split('\n')[0]).toMatch(/^PASS/);
      // PASS 路径不应生成 h12-draft.md
      expect(existsSync(join(sb.sprintDir, 'h12-draft.md'))).toBe(false);
    } finally {
      sb.cleanup();
    }
  });

  it('writes result.md starting with FAIL with all-red-steps list and h12-draft.md marks first-red-step (R1)', () => {
    const sb = makeSandbox();
    try {
      cpSync(FIX_FAIL, sb.evidenceDir, { recursive: true });
      spawnSync(
        'bash',
        [SCRIPT, '00000000-0000-0000-0000-000000000002', sb.evidenceDir, sb.sprintDir],
        { encoding: 'utf8' },
      );
      // FAIL 路径下 judge 仍应正常退出（裁决已写盘），exit code 视实现可为 0 或 1，但产出物必须齐
      const result = readFileSync(join(sb.sprintDir, 'result.md'), 'utf8');
      expect(result.split('\n')[0]).toMatch(/^FAIL/);
      // R1: result.md 须含全部红 step 列表（不只是首红）
      expect(result).toMatch(/Failed Steps:/);
      const h12 = readFileSync(join(sb.sprintDir, 'h12-draft.md'), 'utf8');
      expect(h12.length).toBeGreaterThan(0);
      // R1: h12-draft.md 须显式标注首红 step 为修复入口
      expect(h12).toMatch(/First Red Step:/);
    } finally {
      sb.cleanup();
    }
  });

  it('writes result.md starting with INCONCLUSIVE when inconclusive.flag exists (R5)', () => {
    const sb = makeSandbox();
    try {
      cpSync(FIX_INCONCLUSIVE, sb.evidenceDir, { recursive: true });
      spawnSync(
        'bash',
        [SCRIPT, '00000000-0000-0000-0000-000000000003', sb.evidenceDir, sb.sprintDir],
        { encoding: 'utf8' },
      );
      const result = readFileSync(join(sb.sprintDir, 'result.md'), 'utf8');
      expect(result.split('\n')[0]).toMatch(/^INCONCLUSIVE/);
      // R5: INCONCLUSIVE 路径下不生成 h12-draft.md（外部环境问题，不是 graph bug）
      expect(existsSync(join(sb.sprintDir, 'h12-draft.md'))).toBe(false);
    } finally {
      sb.cleanup();
    }
  });

  it('writes result.md starting with INCONCLUSIVE when trace.txt boot_time crosses (R3)', () => {
    const sb = makeSandbox();
    try {
      cpSync(FIX_BOOT_CROSS, sb.evidenceDir, { recursive: true });
      spawnSync(
        'bash',
        [SCRIPT, '00000000-0000-0000-0000-000000000004', sb.evidenceDir, sb.sprintDir],
        { encoding: 'utf8' },
      );
      const result = readFileSync(join(sb.sprintDir, 'result.md'), 'utf8');
      expect(result.split('\n')[0]).toMatch(/^INCONCLUSIVE/);
      // R3: brain 重启场景下不生成 h12-draft.md
      expect(existsSync(join(sb.sprintDir, 'h12-draft.md'))).toBe(false);
    } finally {
      sb.cleanup();
    }
  });
});
