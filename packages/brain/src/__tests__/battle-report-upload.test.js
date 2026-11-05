import { expect, it, vi } from 'vitest';
import { execFileSync } from 'child_process';
import { writeFileSync } from 'fs';
vi.mock('../notifier.js', () => ({ sendFeishu: vi.fn(async () => true) }));
vi.mock('../receipt-collector.js', () => ({ getUnconfirmedReceipts: vi.fn(async () => []) }));
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
