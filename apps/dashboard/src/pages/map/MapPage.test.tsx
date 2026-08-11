import { existsSync } from 'node:fs';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import planningManifest from '@features/core/planning';
import MapPage from '@features/core/planning/pages/MapPage';

const revision = 'c'.repeat(40);

const envelope = {
  scope_key: 'cecelia',
  manifest_version: 1,
  manifest_digest: 'a'.repeat(64),
  projection_digest: 'b'.repeat(64),
  fact_revisions: { cecelia: revision },
  generated_at: '2026-08-11T10:00:00.000Z',
  freshness: { status: 'fresh', reason_code: 'snapshots_fresh' },
};

const nodes = [
  { key: 'factory', type: 'value_stream', name: '工厂', display_order: 1, attributes: {}, state: 'green', state_reason: 'receipt_passed' },
  { key: 'butler', type: 'value_stream', name: '管家', display_order: 2, attributes: {}, state: 'green', state_reason: 'receipt_passed' },
  { key: 'F0', type: 'capability', name: '事实投影', display_order: 1, attributes: {}, state: 'green', state_reason: 'receipt_passed' },
  { key: 'G1', type: 'capability', name: '统一查询', display_order: 2, attributes: {}, state: 'unknown', state_reason: 'snapshot_stale' },
  { key: 'backbone-1', type: 'backbone', name: '投影骨干', display_order: 1, attributes: {}, state: 'green', state_reason: 'receipt_passed' },
  { key: 'feature-1', type: 'feature', name: '确定性投影', display_order: 1, attributes: {}, state: 'green', state_reason: 'receipt_passed' },
  { key: 'assertion-1', type: 'assertion', name: '投影摘要稳定', display_order: 1, attributes: {}, state: 'green', state_reason: 'receipt_passed' },
  { key: 'artifact-1', type: 'artifact', name: '投影测试', display_order: 1, attributes: { repo: 'cecelia', stable_ref: 'map.test.js' }, state: 'green', state_reason: 'receipt_passed' },
  { key: 'heartbeat_bus', type: 'crosscut', name: '心跳总线', display_order: 1, attributes: {}, state: 'green', state_reason: 'receipt_passed' },
];

const edges = [
  { from: 'factory', to: 'F0', type: 'contains', attributes: {} },
  { from: 'F0', to: 'backbone-1', type: 'contains', attributes: {} },
  { from: 'backbone-1', to: 'feature-1', type: 'contains', attributes: {} },
  { from: 'feature-1', to: 'assertion-1', type: 'proves', attributes: {} },
  { from: 'assertion-1', to: 'artifact-1', type: 'anchored_by', attributes: {} },
  { from: 'F0', to: 'G1', type: 'hands_off_to', attributes: { statement: '投影交给统一查询' } },
  { from: 'heartbeat_bus', to: 'factory', type: 'serves', attributes: {} },
  { from: 'heartbeat_bus', to: 'butler', type: 'serves', attributes: {} },
];

function json(body: unknown, ok = true) {
  return { ok, statusText: ok ? 'OK' : 'Error', json: async () => body } as Response;
}

describe('Universal Map 页面权威', () => {
  beforeEach(() => {
    vi.mocked(global.fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/nodes/assertion-1')) {
        return json({
          ...envelope,
          node: {
            ...nodes.find(({ key }) => key === 'assertion-1'),
            state_details: {
              status: 'green',
              reason_code: 'receipt_passed',
              receipt: { verdict: 'PASS', source_sha: revision, completed_at: '2026-08-11T09:58:00.000Z' },
            },
          },
          upstream: [],
          downstream: [],
          boundaries: [],
          affected_nodes: [],
        });
      }
      if (url.includes('/nodes/')) {
        const key = decodeURIComponent(url.split('/nodes/')[1].split('?')[0]);
        return json({
          ...envelope,
          node: nodes.find((node) => node.key === key),
          upstream: edges.filter((edge) => edge.to === key),
          downstream: edges.filter((edge) => edge.from === key),
          boundaries: edges.filter((edge) => edge.type === 'hands_off_to' && (edge.from === key || edge.to === key)),
          affected_nodes: [],
        });
      }
      if (url.includes('/health')) {
        return json({ ...envelope, overall: 'healthy', layers: { manifest: { status: 'ok' }, facts: { status: 'ok' }, projection: { status: 'ok' }, state_resolver: { status: 'ok' } } });
      }
      return json({
        ...envelope,
        shared_prerequisites: { applicable: false, reason: '两个价值流没有共享前置' },
        nodes,
        edges,
        summary: { value_streams: 2, capabilities: 11, boundaries: 2, crosscuts: 7, prerequisites: 0 },
      });
    });
  });

  afterEach(() => vi.clearAllMocks());

  it('只从动态 feature manifest 注册唯一 /map 页面', () => {
    expect(planningManifest.routes).toContainEqual(expect.objectContaining({
      path: '/map',
      component: 'MapPage',
      navItem: expect.objectContaining({ label: '地图' }),
    }));
    expect(planningManifest.components.MapPage).toBeTypeOf('function');
    expect(existsSync(new URL('./MapPage.tsx', import.meta.url))).toBe(false);
  });

  it('Level 1 展示冻结清单、投影元数据、横切件和不适用前置', async () => {
    render(<MapPage />);

    expect(await screen.findByRole('heading', { name: '通用地图' })).toBeInTheDocument();
    expect(screen.getByText('Manifest v1')).toBeInTheDocument();
    expect(screen.getByText(`投影 ${'b'.repeat(12)}`)).toBeInTheDocument();
    expect(screen.getByText(`cecelia ${revision.slice(0, 12)}`)).toBeInTheDocument();
    expect(screen.getByText('新鲜')).toBeInTheDocument();
    expect(screen.getByText('11 个 Capability')).toBeInTheDocument();
    expect(screen.getByText('2 条边界')).toBeInTheDocument();
    expect(screen.getByText('7 项横切件')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '横切件' })).toBeInTheDocument();
    expect(screen.getByText('共享前置：不适用')).toBeInTheDocument();
    expect(screen.getByText('两个价值流没有共享前置')).toBeInTheDocument();
    expect(screen.getByText('snapshot_stale')).toBeInTheDocument();
  });

  it('从 Capability 下钻到 Feature/Assertion，再显示真实 receipt', async () => {
    render(<MapPage />);

    fireEvent.click(await screen.findByRole('button', { name: /F0 事实投影/ }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/nodes/F0?scope=cecelia')));
    expect(screen.getByRole('heading', { name: 'Level 2 · 事实投影' })).toBeInTheDocument();
    expect(screen.getByText('投影骨干')).toBeInTheDocument();
    expect(screen.getByText('确定性投影')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /投影摘要稳定/ })).toBeInTheDocument();
    expect(screen.getByText('map.test.js')).toBeInTheDocument();
    expect(screen.getByText('投影交给统一查询')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /投影摘要稳定/ }));
    expect(await screen.findByRole('heading', { name: 'Level 3 · 验收证据' })).toBeInTheDocument();
    expect(screen.getByText('PASS')).toBeInTheDocument();
    expect(screen.getByText('receipt_passed')).toBeInTheDocument();
    expect(screen.getByText(revision)).toBeInTheDocument();
    expect(screen.getByText('2026-08-11T09:58:00.000Z')).toBeInTheDocument();
  });
});
