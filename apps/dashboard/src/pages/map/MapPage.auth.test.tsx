import React from 'react';
import { act } from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MapPage from '@features/core/planning/pages/MapPage';

beforeEach(() => {
  global.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({ journeys: [], workflows: [], activities: [], steps: [], implementations: [], counts: {}, gaps: [], areas: [], enablers: [], source_repos: [] }),
  })) as typeof fetch;
});

describe('MapPage privileged actions', () => {
  it('does not expose internal map rebuild through the public dashboard proxy', async () => {
    await act(async () => { render(<MapPage />); });
    expect(screen.queryByRole('button', { name: '重建' })).not.toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls.every(([url]) => !String(url).includes('/rebuild'))).toBe(true);
  });
});
