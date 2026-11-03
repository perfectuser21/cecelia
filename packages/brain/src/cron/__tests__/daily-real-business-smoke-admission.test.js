import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const createTask = vi.hoisted(() => vi.fn());
vi.mock('../../actions.js', () => ({ createTask }));
vi.mock('../../alerting.js', () => ({ raise: vi.fn() }));
vi.mock('../../db.js', () => ({ default: { query: vi.fn() } }));
import { assertSmokeOutput, runDailySmoke } from '../daily-real-business-smoke.js';
const roots = [];
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it('已完成export及9张真实本地图片不能冒充同任务NAS上传验收', async () => {
  const root = mkdtempSync(join(tmpdir(), 'smoke-nas-unverified-')); roots.push(root);
  vi.stubEnv('HOME', root);
  const images = join(root, 'claude-output/images'); mkdirSync(images, { recursive: true });
  for (let i = 0; i < 9; i++) writeFileSync(join(images, `fixture-topic-${i}.png`), 'local-only');
  const db = { query: vi.fn().mockResolvedValue({ rows: [{ task_type: 'content-export', status: 'completed', summary: null }] }) };
  const result = await assertSmokeOutput(db, 'fixture-task', { keyword: 'fixture-topic' });
  expect(result.imageCount).toBe(9);
  expect(result.ok).toBe(false);
  expect(result.nasOk).toBe(false);
  expect(result.message).toContain('NAS');
  expect(result.message).toContain('未核验');
});

it.each(['2026-11-03T20:01:00Z', '2026-11-03T12:00:00Z'])('缺少NAS合同的旧自动入口明确disabled且不创建付费工作：%s', async timestamp => {
  const db = { query: vi.fn().mockRejectedValue(new Error('不得触碰自动任务数据库')) };
  const result = await runDailySmoke(db, new Date(timestamp));
  expect(result).toMatchObject({ triggered: false, disabled: true, reason: 'nas_verification_unavailable' });
  expect(createTask).not.toHaveBeenCalled();
  expect(db.query).not.toHaveBeenCalled();
});
