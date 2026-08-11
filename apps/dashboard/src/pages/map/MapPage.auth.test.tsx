import React from 'react';
import { act } from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MapPage from '@features/core/planning/pages/MapPage';

beforeEach(() => {
  global.fetch = vi.fn(async (input) => ({
    ok: true,
    json: async () => String(input).includes('/health') ? { layers: {}, overall: 'fresh' } : ({
      scope_key: 'cecelia',
      manifest_version: 1,
      manifest_digest: 'a'.repeat(64),
      projection_digest: 'b'.repeat(64),
      fact_revisions: {},
      generated_at: '2026-08-11T00:00:00.000Z',
      freshness: { status: 'fresh' },
      shared_prerequisites: { applicable: false, reason: 'none declared' },
      nodes: [], edges: [],
      summary: { value_streams: 0, capabilities: 0, crosscuts: 0, prerequisites: 0, boundaries: 0 },
    }),
  })) as typeof fetch;
});

describe('MapPage privileged actions', () => {
  it('does not expose internal map rebuild through the public dashboard proxy', async () => {
    await act(async () => { render(<MapPage />); });
    expect(screen.queryByRole('button', { name: '重建' })).not.toBeInTheDocument();
  });
});
