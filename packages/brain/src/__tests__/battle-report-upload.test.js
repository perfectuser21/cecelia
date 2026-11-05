import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { battleEffects, resetBattleEffects } from './helpers/battle-report-effects.js';
import { execFileSync } from 'child_process';
import { writeFileSync } from 'fs';
beforeEach(() => {
  resetBattleEffects();
  expect(execFileSync).toBe(battleEffects.execFileSync);
  expect(writeFileSync).toBe(battleEffects.writeFileSync);
});
afterEach(() => { expect(battleEffects.unexpected).not.toHaveBeenCalled(); });
import { generateBattleReport } from '../battle-report.js';

it('实际generate仅委托HTML写入与SSH adapter，文件与stdin为相同真实HTML', async () => {
  const pool = { query: vi.fn(async sql => ({ rows: /INSERT INTO design_docs/.test(sql) ? [{ id: 'owned-report' }] : [] })) };
  const result = await generateBattleReport(pool);
  expect(result.id).toBe('owned-report');
  expect(writeFileSync).toHaveBeenCalledOnce();
  const [path, html, encoding] = writeFileSync.mock.calls[0];
  expect(path).toMatch(/^\/tmp\/battle-report-\d{4}-\d{2}-\d{2}\.html$/);
  expect(html).toMatch(/<!doctype html>/i); expect(html).toContain('Cecelia · Daily Battle Report');
  expect(encoding).toBe('utf8');
  expect(execFileSync).toHaveBeenCalledOnce();
  expect(execFileSync).toHaveBeenCalledWith('ssh', [
    '-o', 'StrictHostKeyChecking=no', '-o', 'ConnectTimeout=10', 'hk-vps',
    'sudo mkdir -p /data/docs/daily-report && sudo tee /data/docs/daily-report/index.html > /dev/null',
  ], { input: html, timeout: 20000 });
});

it('SSH adapter失败不回滚已生成日报，也不再发第二次通知', async () => {
  battleEffects.execFileSync.mockImplementationOnce(() => { throw Error('owned SSH unavailable'); });
  const pool = { query: vi.fn(async sql => ({ rows: /INSERT INTO design_docs/.test(sql) ? [{ id: 'stored-report' }] : [] })) };
  expect(await generateBattleReport(pool)).toMatchObject({ id: 'stored-report' });
  expect(battleEffects.execFileSync).toHaveBeenCalledOnce();
  expect(battleEffects.sendFeishu).toHaveBeenCalledOnce();
  expect(pool.query.mock.calls.filter(([sql]) => /INSERT INTO design_docs/.test(sql))).toHaveLength(1);
});
it('本地HTML adapter失败时不启动SSH，已存储报告仍成功返回', async () => {
  battleEffects.writeFileSync.mockImplementationOnce(() => { throw Error('owned local HTML unavailable'); });
  const pool = { query: vi.fn(async sql => ({ rows: /INSERT INTO design_docs/.test(sql) ? [{ id: 'stored-report' }] : [] })) };
  expect(await generateBattleReport(pool)).toMatchObject({ id: 'stored-report' });
  expect(battleEffects.writeFileSync).toHaveBeenCalledOnce();
  expect(battleEffects.execFileSync).not.toHaveBeenCalled();
});
