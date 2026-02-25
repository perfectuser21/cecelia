import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch globally
global.fetch = vi.fn();

describe('Brain API Client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parseIntent calls /intent/parse API', async () => {
    const mockResponse = {
      intentType: 'create_task',
      confidence: 0.9,
      entities: {},
    };

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    // Import functions dynamically to use mocked fetch
    const { parseIntent } = await import('../routes.js');
    const result = await parseIntent('add a new task');

    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:5221/intent/parse',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    );
    expect(result).toEqual(mockResponse);
  });

  it('parseAndCreate calls /intent/create API', async () => {
    const mockResponse = {
      created: { tasks: [{ title: 'New task' }] },
    };

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const { parseAndCreate } = await import('../routes.js');
    const result = await parseAndCreate('create a new task', { createTasks: true });

    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:5221/intent/create',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    );
    expect(result).toEqual(mockResponse);
  });

  it('throws error when API returns non-ok response', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      statusText: 'Internal Server Error',
    });

    const { parseIntent } = await import('../routes.js');
    
    await expect(parseIntent('test')).rejects.toThrow('Brain API error: Internal Server Error');
  });

  it('INTENT_TYPES constants are defined', async () => {
    const { INTENT_TYPES } = await import('../routes.js');
    
    expect(INTENT_TYPES.CREATE_PROJECT).toBe('create_project');
    expect(INTENT_TYPES.CREATE_TASK).toBe('create_task');
    expect(INTENT_TYPES.FIX_BUG).toBe('fix_bug');
    expect(INTENT_TYPES.UNKNOWN).toBe('unknown');
  });
});
