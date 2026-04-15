/**
 * langfuse-reporter.js 单元测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockReadFileSync } = vi.hoisted(() => ({ mockReadFileSync: vi.fn() }));
vi.mock('fs', () => ({ readFileSync: mockReadFileSync }));
vi.mock('os', () => ({ homedir: vi.fn(() => '/mock/home') }));

import { isEnabled, buildIngestionPayload, _reset } from '../langfuse-reporter.js';

describe('langfuse-reporter', () => {
  beforeEach(() => {
    _reset();
    mockReadFileSync.mockReset();
  });

  describe('isEnabled()', () => {
    it('returns false when env file missing', () => {
      mockReadFileSync.mockImplementation(() => {
        const err = new Error('ENOENT');
        err.code = 'ENOENT';
        throw err;
      });
      expect(isEnabled()).toBe(false);
    });

    it('returns false when required keys incomplete', () => {
      mockReadFileSync.mockReturnValue('LANGFUSE_PUBLIC_KEY="pk"\n');
      expect(isEnabled()).toBe(false);
    });

    it('returns true when all three keys present', () => {
      mockReadFileSync.mockReturnValue(
        'LANGFUSE_PUBLIC_KEY="pk-lf-x"\nLANGFUSE_SECRET_KEY="sk-lf-x"\nLANGFUSE_BASE_URL="http://h:3000"\n'
      );
      expect(isEnabled()).toBe(true);
    });
  });

  describe('buildIngestionPayload()', () => {
    it('produces batch with trace-create + generation-create', () => {
      const payload = buildIngestionPayload({
        agentId: 'thalamus',
        model: 'claude-haiku-4-5-20251001',
        provider: 'anthropic',
        prompt: 'hi',
        text: 'hello',
        elapsedMs: 120,
        startedAt: Date.now() - 120,
      });
      expect(payload.batch).toHaveLength(2);
      expect(payload.batch[0].type).toBe('trace-create');
      expect(payload.batch[1].type).toBe('generation-create');
      expect(payload.batch[0].body.metadata.agentId).toBe('thalamus');
      expect(payload.batch[1].body.model).toBe('claude-haiku-4-5-20251001');
      expect(payload.batch[1].body.level).toBe('DEFAULT');
    });

    it('error path sets level=ERROR and output=null', () => {
      const payload = buildIngestionPayload({
        agentId: 'mouth',
        model: 'm',
        provider: 'p',
        prompt: 'q',
        error: new Error('boom'),
        elapsedMs: 50,
        startedAt: Date.now() - 50,
      });
      expect(payload.batch[1].body.level).toBe('ERROR');
      expect(payload.batch[1].body.statusMessage).toContain('boom');
      expect(payload.batch[0].body.output).toBeNull();
      expect(payload.batch[1].body.output).toBeNull();
    });

    it('truncates long prompt/output to 10000 chars with marker', () => {
      const big = 'x'.repeat(15000);
      const payload = buildIngestionPayload({
        agentId: 'a',
        model: 'm',
        provider: 'p',
        prompt: big,
        text: big,
        elapsedMs: 1,
        startedAt: Date.now(),
      });
      expect(payload.batch[1].body.input.length).toBeLessThan(15000);
      expect(payload.batch[1].body.input).toContain('…[truncated]');
    });
  });
});
