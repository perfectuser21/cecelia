import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BrainSystemTab from './BrainSystemTab';

function mockFetch(consciousnessStatus: any, mutedStatus: any, patchResponses?: Record<string, any>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((url: any, init?: any) => {
    const u = typeof url === 'string' ? url : url.toString();
    const method = init?.method?.toUpperCase() ?? 'GET';
    if (method === 'PATCH' && patchResponses) {
      if (u.includes('/consciousness') && patchResponses.consciousness) {
        return Promise.resolve(new Response(JSON.stringify(patchResponses.consciousness), { status: 200 }));
      }
      if (u.includes('/muted') && patchResponses.muted) {
        return Promise.resolve(new Response(JSON.stringify(patchResponses.muted), { status: 200 }));
      }
    }
    if (u.includes('/consciousness')) {
      return Promise.resolve(new Response(JSON.stringify(consciousnessStatus), { status: 200 }));
    }
    if (u.includes('/muted')) {
      return Promise.resolve(new Response(JSON.stringify(mutedStatus), { status: 200 }));
    }
    return Promise.reject(new Error('Unexpected URL: ' + u));
  });
}

describe('SettingsPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test('renders consciousness status after fetch', async () => {
    mockFetch(
      { enabled: true, last_toggled_at: null, env_override: false },
      { enabled: false, last_toggled_at: null, env_override: false }
    );
    render(<BrainSystemTab />);
    await waitFor(() => expect(screen.getByText(/意识开关/)).toBeInTheDocument());
    expect(screen.getByTestId('consciousness-toggle')).toHaveAttribute('aria-pressed', 'true');
  });

  test('click consciousness toggle sends PATCH', async () => {
    const fetchSpy = mockFetch(
      { enabled: true, last_toggled_at: null, env_override: false },
      { enabled: false, last_toggled_at: null, env_override: false },
      { consciousness: { enabled: false, last_toggled_at: '2026-04-21T00:00:00Z', env_override: false } }
    );
    render(<BrainSystemTab />);
    await waitFor(() => screen.getByTestId('consciousness-toggle'));
    fireEvent.click(screen.getByTestId('consciousness-toggle'));
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/brain/settings/consciousness',
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ enabled: false }) })
      );
    });
  });

  test('consciousness env_override disables toggle + shows warning', async () => {
    mockFetch(
      { enabled: false, last_toggled_at: null, env_override: true },
      { enabled: false, last_toggled_at: null, env_override: false }
    );
    render(<BrainSystemTab />);
    await waitFor(() => screen.getByTestId('consciousness-env-override-warning'));
    expect(screen.getByTestId('consciousness-toggle')).toBeDisabled();
  });

  test('renders muted status after fetch', async () => {
    mockFetch(
      { enabled: true, last_toggled_at: null, env_override: false },
      { enabled: true, last_toggled_at: null, env_override: false }
    );
    render(<BrainSystemTab />);
    await waitFor(() => expect(screen.getByText(/飞书静默开关/)).toBeInTheDocument());
    expect(screen.getByTestId('muted-toggle')).toHaveAttribute('aria-pressed', 'true');
  });

  test('click muted toggle sends PATCH to /muted', async () => {
    const fetchSpy = mockFetch(
      { enabled: true, last_toggled_at: null, env_override: false },
      { enabled: false, last_toggled_at: null, env_override: false },
      { muted: { enabled: true, last_toggled_at: '2026-04-21T00:00:00Z', env_override: false } }
    );
    render(<BrainSystemTab />);
    await waitFor(() => screen.getByTestId('muted-toggle'));
    fireEvent.click(screen.getByTestId('muted-toggle'));
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/brain/settings/muted',
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ enabled: true }) })
      );
    });
  });

  test('muted env_override disables toggle + shows warning', async () => {
    mockFetch(
      { enabled: true, last_toggled_at: null, env_override: false },
      { enabled: true, last_toggled_at: null, env_override: true }
    );
    render(<BrainSystemTab />);
    await waitFor(() => screen.getByTestId('muted-env-override-warning'));
    expect(screen.getByTestId('muted-toggle')).toBeDisabled();
  });
});
