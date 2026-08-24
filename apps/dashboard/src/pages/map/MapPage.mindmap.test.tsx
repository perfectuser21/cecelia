import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import MapPage from '@features/core/planning/pages/MapPage';

// B-03 覆盖：/map 页在既有语义 DOM 之外 additive 挂载 mind-elixir 容器（data-testid=map-mindmap），
// 且 freshness.status != fresh 时出现可见提示（role=status），不静默。
// 说明：mind-elixir 真实 init() 在真浏览器 E2E 断言（jsdom/happy-dom 下被 MapPage 的
// feature-detect guard 跳过），本单测只断言容器与陈旧提示这两个语义 DOM。

const revision = 'c'.repeat(40);

const baseEnvelope = {
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
  { key: 'F0', type: 'capability', name: '事实投影', display_order: 1, attributes: {}, state: 'green', state_reason: 'receipt_passed' },
];

const edges = [
  { from: 'factory', to: 'F0', type: 'contains', attributes: {} },
];

function json(body: unknown, ok = true) {
  return { ok, statusText: ok ? 'OK' : 'Error', json: async () => body } as Response;
}

function mockMap(freshness: { status: string; reason_code?: string }) {
  vi.mocked(global.fetch).mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes('/health')) return json({ ...baseEnvelope, overall: 'healthy' });
    return json({
      ...baseEnvelope,
      freshness,
      shared_prerequisites: { applicable: false, reason: '无共享前置' },
      nodes,
      edges,
      summary: { value_streams: 1, capabilities: 1, boundaries: 0, crosscuts: 0, prerequisites: 0 },
    });
  });
}

describe('MapPage mind-elixir 三层脑图 + freshness 提示', () => {
  afterEach(() => vi.clearAllMocks());

  describe('mind-elixir 容器', () => {
    beforeEach(() => mockMap({ status: 'fresh', reason_code: 'snapshots_fresh' }));

    it('渲染 MapPage 出现 data-testid=map-mindmap 容器', async () => {
      render(<MapPage />);
      expect(await screen.findByRole('heading', { name: '通用地图' })).toBeInTheDocument();
      expect(await screen.findByTestId('map-mindmap')).toBeInTheDocument();
    });

    it('freshness=fresh 时不出现陈旧提示', async () => {
      render(<MapPage />);
      await screen.findByTestId('map-mindmap');
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
  });

  describe('freshness 非 fresh 提示', () => {
    beforeEach(() => mockMap({ status: 'stale', reason_code: 'snapshot_stale' }));

    it('freshness.status != fresh 时出现可见提示元素（role=status）', async () => {
      render(<MapPage />);
      const prompt = await screen.findByRole('status');
      expect(prompt).toBeInTheDocument();
      expect(prompt).toHaveTextContent(/非最新|陈旧/);
    });
  });
});
