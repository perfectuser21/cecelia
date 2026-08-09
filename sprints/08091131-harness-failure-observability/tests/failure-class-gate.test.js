import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// TDD Red: 机械闸脚本尚未实现 → spawn node 退出码非预期 = 真红
const GATE = 'packages/brain/scripts/ci/harness-terminal-failure-class-gate.mjs';
function runGate(args) {
  return spawnSync('node', [GATE, ...args], { cwd: process.cwd(), encoding: 'utf8' });
}

describe('failure-class-gate [BEHAVIOR]', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gate-'));

  it('脏 fixture 命中 exit 1', () => {
    const f = join(dir, 'dirty.js');
    writeFileSync(f, "await pool.query(`UPDATE tasks SET status='failed' WHERE id=$1`,[id]);\n");
    const r = runGate([`--fixture-files=${f}`]);
    expect(r.status).toBe(1);
  });

  it('干净 fixture exit 0', () => {
    const f = join(dir, 'clean.js');
    writeFileSync(
      f,
      "await pool.query(`UPDATE tasks SET status='failed', result=result||jsonb_build_object('failure_class','invalid_gear') WHERE id=$1`,[id]);\n",
    );
    const r = runGate([`--fixture-files=${f}`]);
    expect(r.status).toBe(0);
    rmSync(dir, { recursive: true, force: true });
  });
});
