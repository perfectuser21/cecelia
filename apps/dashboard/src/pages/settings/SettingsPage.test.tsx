import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SettingsPage from './SettingsPage';

describe('SettingsPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test('renders status after fetch', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ enabled: true, last_toggled_at: null, env_override: false }), { status: 200 })
    );
    render(<SettingsPage />);
    await waitFor(() => expect(screen.getByText(/意识开关/)).toBeInTheDocument());
    expect(screen.getByTestId('consciousness-toggle')).toHaveAttribute('aria-pressed', 'true');
  });

  test('click toggle sends PATCH', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ enabled: true, last_toggled_at: null, env_override: false }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ enabled: false, last_toggled_at: '2026-04-20T01:00:00Z', env_override: false }),
          { status: 200 }
        )
      );
    render(<SettingsPage />);
    await waitFor(() => screen.getByTestId('consciousness-toggle'));
    fireEvent.click(screen.getByTestId('consciousness-toggle'));
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/brain/settings/consciousness',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ enabled: false }),
        })
      );
    });
  });

  test('env_override disables toggle + shows warning', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ enabled: false, last_toggled_at: null, env_override: true }), { status: 200 })
    );
    render(<SettingsPage />);
    await waitFor(() => screen.getByTestId('env-override-warning'));
    expect(screen.getByTestId('consciousness-toggle')).toBeDisabled();
  });
});
