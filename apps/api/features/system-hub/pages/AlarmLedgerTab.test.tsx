import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AlarmLedgerTab, { filterAlarms, formatBeijing } from './AlarmLedgerTab';
import type { AlarmRow } from './AlarmLedgerTab';

const row = (over: Partial<AlarmRow>): AlarmRow => ({
  id: '1', name: 'ci-patrol', machine: 'us-vps', source: 'brain', mechanism: 'brain-job', cadence: 'cron(Asia/Shanghai): 0 8 * * *',
  enabled: true,
  tree: { path: '研发与上线部 / 工厂价值流 / F2 部署闭环', department: '研发与上线部', value_stream: '工厂价值流', capability: 'F2 部署闭环', bucket: null },
  last_run_at: '2026-10-04T01:00:00Z', last_success_at: '2026-10-04T01:00:00Z', last_status: '正常', liveness: 'ok', note: '备注A', ledger_status: 'registered',
  ...over,
});

const ROWS: AlarmRow[] = [
  row({}),
  row({ id: '2', name: 'janitor.sh @ */15', machine: 'mmv', source: 'crontab', mechanism: 'crontab', last_status: '失败', note: null,
    tree: { path: null, department: null, value_stream: null, capability: null, bucket: null }, ledger_status: 'unregistered' }),
  row({ id: '3', name: 'old-task', machine: 'xian-pc', source: 'inventory-20261004', mechanism: 'win-schtask', enabled: false, last_status: '无记录', last_run_at: null, last_success_at: null,
    tree: { path: '无（淘汰方案）', department: null, value_stream: null, capability: null, bucket: '无（淘汰方案）' } }),
];

function mockFetch(status: number, body: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body })));
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('闹钟总账页', () => {
  it('渲染 11 列表头、全部行、汇总与北京时间', async () => {
    mockFetch(200, { success: true, data: {
      alarms: ROWS, sources: [{ source: 'crontab', host_alias: 'mmv', source_status: 'parse_error', stale: true, last_report_at: null }],
      summary: { total: 3, enabled: 2, unregistered: 1, without_tree: 1 }, server_now: '2026-10-04T02:00:00Z',
    } });
    render(<AlarmLedgerTab />);
    expect(await screen.findByText('ci-patrol')).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader')).toHaveLength(11);
    expect(screen.getByText('janitor.sh @ */15')).toBeInTheDocument();
    expect(screen.getByText('old-task')).toBeInTheDocument();
    expect(screen.getByText('显示 3 / 3')).toBeInTheDocument();
    expect(screen.getByText(/采集来源异常\/过期：crontab@mmv\(parse_error\)/)).toBeInTheDocument();
    expect(screen.getAllByText('未挂树').length).toBeGreaterThan(0);
    expect(formatBeijing('2026-10-04T01:00:00Z')).toMatch(/10.?04.*09:00/);
    expect(formatBeijing(null)).toBe('—');
  });

  it('按状态筛选只留失败行；搜索按名称过滤', async () => {
    mockFetch(200, { success: true, data: { alarms: ROWS, sources: [], summary: { total: 3, enabled: 2, unregistered: 1, without_tree: 1 }, server_now: 'x' } });
    render(<AlarmLedgerTab />);
    await screen.findByText('ci-patrol');
    fireEvent.change(screen.getByLabelText('状态'), { target: { value: '失败' } });
    expect(screen.queryByText('ci-patrol')).not.toBeInTheDocument();
    expect(screen.getByText('janitor.sh @ */15')).toBeInTheDocument();
    expect(screen.getByText('显示 1 / 3')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('状态'), { target: { value: '全部' } });
    fireEvent.change(screen.getByLabelText('搜索'), { target: { value: 'old-' } });
    expect(screen.getByText('显示 1 / 3')).toBeInTheDocument();
  });

  it('503（迁移未上）给出说明，不假装 0 条', async () => {
    mockFetch(503, { success: false, error: { code: 'migration_pending', message: 'x' } });
    render(<AlarmLedgerTab />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('517'));
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('filterAlarms：机器/机制/部门（含"未挂树"）组合', () => {
    const f = { machine: '全部', mechanism: '全部', status: '全部', department: '全部', q: '' };
    expect(filterAlarms(ROWS, { ...f, machine: 'mmv' }).map((r) => r.id)).toEqual(['2']);
    expect(filterAlarms(ROWS, { ...f, mechanism: 'win-schtask' }).map((r) => r.id)).toEqual(['3']);
    expect(filterAlarms(ROWS, { ...f, department: '研发与上线部' }).map((r) => r.id)).toEqual(['1']);
    expect(filterAlarms(ROWS, { ...f, department: '未挂树' }).map((r) => r.id)).toEqual(['2']);
  });
});
