import React from 'react';
import { act } from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MapPage from './MapPage';

beforeEach(() => {
  global.fetch = vi.fn(async (input) => ({
    ok: true,
    json: async () => String(input).includes('/health') ? { layers: {}, overall: 'fresh' } : ({
      nodes: [], edges: [], fact_revisions: {},
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
