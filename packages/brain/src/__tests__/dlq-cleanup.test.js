/**
 * dlq-cleanup.test.js
 *
 * cleanDlq 单元测试：7 天 mtime 自动清理逻辑。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, utimesSync, rmSync } from 'fs';
import path from 'path';
import os from 'os';

const mockQuery = vi.hoisted(() => vi.fn());
vi.mock('../db.js', () => ({ default: { query: mockQuery } }));

vi.mock('../spawn/middleware/docker-run.js', () => ({ runDocker: vi.fn() }));
vi.mock('../spawn/middleware/account-rotation.js', () => ({ resolveAccount: vi.fn() }));
vi.mock('../spawn/middleware/cascade.js', () => ({ resolveCascade: vi.fn() }));
vi.mock('../spawn/middleware/cost-cap.js', () => ({ checkCostCap: vi.fn() }));
vi.mock('../spawn/middleware/cap-marking.js', () => ({ checkCap: vi.fn() }));
vi.mock('../spawn/middleware/billing.js', () => ({ recordBilling: vi.fn() }));
vi.mock('../spawn/middleware/logging.js', () => ({ createSpawnLogger: vi.fn(() => ({ log: vi.fn(), end: vi.fn() })) }));

let cleanDlq;
let testDir;

beforeEach(async () => {
  vi.resetModules();
  testDir = path.join(os.tmpdir(), `dlq-test-${process.hrtime.bigint()}`);
  mkdirSync(testDir, { recursive: true });
  const mod = await import('../docker-executor.js');
  cleanDlq = mod.cleanDlq;
});

afterEach(() => {
  if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
});

function writeJson(dir, name) {
  const fp = path.join(dir, name);
  writeFileSync(fp, '{}', 'utf8');
  return fp;
}

function setMtime(fp, msSinceEpoch) {
  const t = new Date(msSinceEpoch);
  utimesSync(fp, t, t);
}

describe('cleanDlq — 7天 mtime 清理', () => {
  it('目录不存在时返回 { deleted: 0 }', () => {
    const result = cleanDlq('/tmp/dlq-nonexistent-' + Date.now());
    expect(result).toEqual({ deleted: 0 });
  });

  it('空目录返回 { deleted: 0 }', () => {
    expect(cleanDlq(testDir)).toEqual({ deleted: 0 });
  });

  it('8天前的 .json 文件被删除', () => {
    const fp = writeJson(testDir, 'old.json');
    setMtime(fp, Date.now() - 8 * 24 * 60 * 60 * 1000);
    const result = cleanDlq(testDir);
    expect(result.deleted).toBe(1);
    expect(existsSync(fp)).toBe(false);
  });

  it('6天前的 .json 文件保留', () => {
    const fp = writeJson(testDir, 'recent.json');
    setMtime(fp, Date.now() - 6 * 24 * 60 * 60 * 1000);
    const result = cleanDlq(testDir);
    expect(result.deleted).toBe(0);
    expect(existsSync(fp)).toBe(true);
  });

  it('非 .json 文件不受影响', () => {
    const fp = path.join(testDir, 'notes.txt');
    writeFileSync(fp, 'hello', 'utf8');
    setMtime(fp, Date.now() - 10 * 24 * 60 * 60 * 1000);
    expect(cleanDlq(testDir).deleted).toBe(0);
    expect(existsSync(fp)).toBe(true);
  });

  it('混合场景：只删过期文件', () => {
    const old1 = writeJson(testDir, 'old1.json');
    const old2 = writeJson(testDir, 'old2.json');
    const fresh = writeJson(testDir, 'fresh.json');
    setMtime(old1, Date.now() - 8 * 24 * 60 * 60 * 1000);
    setMtime(old2, Date.now() - 30 * 24 * 60 * 60 * 1000);
    setMtime(fresh, Date.now() - 1 * 24 * 60 * 60 * 1000);
    const result = cleanDlq(testDir);
    expect(result.deleted).toBe(2);
    expect(existsSync(old1)).toBe(false);
    expect(existsSync(old2)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
  });
});
