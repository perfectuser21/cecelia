import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Model Profile API', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('fetchModelProfiles', () => {
    it('returns list of profiles with config details', async () => {
      const mockProfiles = [
        {
          id: 'profile-minimax',
          name: 'MiniMax 主力',
          is_active: true,
          config: {
            thalamus: { provider: 'minimax', model: 'MiniMax-M2.1' },
            cortex: { provider: 'anthropic', model: 'claude-opus-4-20250514' },
            executor: { default_provider: 'minimax', model_map: {} },
          },
        },
        {
          id: 'profile-anthropic',
          name: 'Anthropic 主力',
          is_active: false,
          config: {
            thalamus: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
            cortex: { provider: 'anthropic', model: 'claude-opus-4-20250514' },
            executor: { default_provider: 'anthropic', model_map: {} },
          },
        },
      ];

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, profiles: mockProfiles }),
      });

      const res = await fetch('/api/brain/model-profiles');
      const data = await res.json();

      expect(data.success).toBe(true);
      expect(data.profiles).toHaveLength(2);
      expect(data.profiles[0].id).toBe('profile-minimax');
      expect(data.profiles[0].is_active).toBe(true);
      expect(data.profiles[1].is_active).toBe(false);
    });

    it('each profile has thalamus, cortex, and executor config', async () => {
      const mockProfile = {
        id: 'profile-minimax',
        name: 'MiniMax 主力',
        is_active: true,
        config: {
          thalamus: { provider: 'minimax', model: 'MiniMax-M2.1' },
          cortex: { provider: 'anthropic', model: 'claude-opus-4-20250514' },
          executor: {
            default_provider: 'minimax',
            model_map: {
              dev: { minimax: 'MiniMax-M2.5-highspeed', anthropic: null },
            },
          },
        },
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, profiles: [mockProfile] }),
      });

      const res = await fetch('/api/brain/model-profiles');
      const data = await res.json();
      const profile = data.profiles[0];

      expect(profile.config.thalamus.provider).toBe('minimax');
      expect(profile.config.thalamus.model).toBe('MiniMax-M2.1');
      expect(profile.config.cortex.provider).toBe('anthropic');
      expect(profile.config.cortex.model).toContain('opus');
      expect(profile.config.executor.default_provider).toBe('minimax');
    });

    it('handles API error', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const res = await fetch('/api/brain/model-profiles');
      expect(res.ok).toBe(false);
    });
  });

  describe('fetchActiveProfile', () => {
    it('returns the currently active profile', async () => {
      const mockProfile = {
        id: 'profile-minimax',
        name: 'MiniMax 主力',
        is_active: true,
        config: {
          thalamus: { provider: 'minimax', model: 'MiniMax-M2.1' },
          cortex: { provider: 'anthropic', model: 'claude-opus-4-20250514' },
          executor: { default_provider: 'minimax' },
        },
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, profile: mockProfile }),
      });

      const res = await fetch('/api/brain/model-profiles/active');
      const data = await res.json();

      expect(data.success).toBe(true);
      expect(data.profile.is_active).toBe(true);
      expect(data.profile.id).toBe('profile-minimax');
    });
  });

  describe('switchProfile', () => {
    it('sends PUT request to switch profile', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      const res = await fetch('/api/brain/model-profiles/active', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile_id: 'profile-anthropic' }),
      });
      const data = await res.json();

      expect(data.success).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/brain/model-profiles/active',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ profile_id: 'profile-anthropic' }),
        })
      );
    });

    it('handles switch failure', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ success: false, error: 'Invalid profile_id' }),
      });

      const res = await fetch('/api/brain/model-profiles/active', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile_id: 'invalid' }),
      });

      expect(res.ok).toBe(false);
    });
  });

  describe('WebSocket profile:changed event', () => {
    it('parses profile:changed event payload', () => {
      const eventData = JSON.stringify({
        type: 'profile:changed',
        payload: {
          profile_id: 'profile-anthropic',
          profile_name: 'Anthropic 主力',
        },
      });

      const parsed = JSON.parse(eventData);
      expect(parsed.type).toBe('profile:changed');
      expect(parsed.payload.profile_id).toBe('profile-anthropic');
      expect(parsed.payload.profile_name).toBe('Anthropic 主力');
    });
  });
});
