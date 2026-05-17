import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock db.js before importing the route
vi.mock('../packages/brain/src/db.js', () => ({
  default: {
    query: vi.fn(),
  },
}));

// Mock express Router
const mockRouter = {
  get: vi.fn(),
  post: vi.fn(),
};
vi.mock('express', () => ({
  Router: vi.fn(() => mockRouter),
  default: { Router: vi.fn(() => mockRouter) },
}));

describe('conversation-captures route structure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('route file exports a default router', async () => {
    const mod = await import('../packages/brain/src/routes/conversation-captures.js');
    expect(mod.default).toBeDefined();
  });

  it('router registers GET / handler', async () => {
    await import('../packages/brain/src/routes/conversation-captures.js');
    const getCalls = mockRouter.get.mock.calls.map(c => c[0]);
    expect(getCalls).toContain('/');
  });

  it('router registers POST / handler', async () => {
    await import('../packages/brain/src/routes/conversation-captures.js');
    const postCalls = mockRouter.post.mock.calls.map(c => c[0]);
    expect(postCalls).toContain('/');
  });

  it('router registers GET /:id handler', async () => {
    await import('../packages/brain/src/routes/conversation-captures.js');
    const getCalls = mockRouter.get.mock.calls.map(c => c[0]);
    expect(getCalls).toContain('/:id');
  });
});
