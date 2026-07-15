import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const SPRINT_DIR = 'sprints/07151206-relay-cd0b936c';
const SCRIPT = path.join(REPO_ROOT, SPRINT_DIR, 'e2e-verify.sh');
const TASK_ID = 'cd0b936c-2891-4fed-a921-5636ca08d1e8';

describe('e2e-verify.sh 契约 [BEHAVIOR]', () => {
  it('TASK_ID 默认值精确等于本轮 task_id（非照抄旧文件默认值）', () => {
    const content = fs.readFileSync(SCRIPT, 'utf8');
    expect(content).toContain(`TASK_ID:-${TASK_ID}`);
    expect(content).not.toContain('TASK_ID:-4bb31ef5-e140-41f4-9daf-9ca4a9e51216');
  });

  it('SPRINT_DIR 默认值精确等于本轮 sprint 目录', () => {
    const content = fs.readFileSync(SCRIPT, 'utf8');
    expect(content).toContain(`SPRINT_DIR:-${SPRINT_DIR}`);
  });

  it('e2e-verify.sh 全流程真实执行返回 OK headed smoke regression verified for cd0b936c', () => {
    const out = execSync(`bash ${SCRIPT}`, {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        BRAIN_URL: process.env.BRAIN_URL || 'http://localhost:5221',
        DATABASE_URL:
          process.env.DATABASE_URL ||
          'postgresql://cecelia:cecelia@localhost:5432/cecelia',
      },
    }).toString();
    expect(out).toContain(`OK headed smoke regression verified for ${TASK_ID}`);
  });

  it('陌生 task_id 下脚本必须 FAIL（exit 非 0），不 sleep/retry 掩盖', () => {
    const start = Date.now();
    let failed = false;
    try {
      execSync(`bash ${SCRIPT}`, {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          TASK_ID: '00000000-0000-0000-0000-000000000000',
          BRAIN_URL: process.env.BRAIN_URL || 'http://localhost:5221',
          DATABASE_URL:
            process.env.DATABASE_URL ||
            'postgresql://cecelia:cecelia@localhost:5432/cecelia',
        },
        stdio: 'pipe',
      });
    } catch {
      failed = true;
    }
    const elapsedSec = (Date.now() - start) / 1000;
    expect(failed).toBe(true);
    expect(elapsedSec).toBeLessThan(15);
  });

  it('relay-4bb31ef5.sh 未被修改（历史锚点保留）', () => {
    const diff = execSync(
      'git diff HEAD -- scripts/smoke/e2e/relay-4bb31ef5.sh',
      { cwd: REPO_ROOT }
    ).toString();
    expect(diff.trim()).toBe('');
  });
});
