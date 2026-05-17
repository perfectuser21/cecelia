/**
 * llm-caller-stream.test.js
 * 测试 callLLMStream / callMiniMaxAPIStream
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock model-profile.js
vi.mock('../model-profile.js', () => ({
  getActiveProfile: vi.fn().mockReturnValue({
    config: {
      mouth: { model: 'MiniMax-M2.5-highspeed', provider: 'minimax' },
    },
  }),
}));

// Mock fs (for MiniMax key loading)
vi.mock('fs', () => ({
  readFileSync: vi.fn().mockReturnValue(JSON.stringify({ api_key: 'test-key-123' })),
}));

// Mock global fetch for streaming
const mockFetch = vi.fn();
global.fetch = mockFetch;

import { callLLM, callLLMStream, _resetMinimaxKey } from '../llm-caller.js';

/**
 * 创建一个模拟 SSE 流
 * @param {string[]} chunks - SSE chunk data 数组
 */
function createSSEStream(chunks) {
  const encoder = new TextEncoder();
  let pos = 0;

  return new ReadableStream({
    pull(controller) {
      if (pos >= chunks.length) {
        controller.close();
        return;
      }
      const chunk = chunks[pos++];
      controller.enqueue(encoder.encode(chunk));
    },
  });
}

describe('llm-caller-stream', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetMinimaxKey();
  });

  describe('callLLMStream - minimax', () => {
    it('parses SSE chunks and calls onChunk for each delta', async () => {
      const sseChunks = [
        'data: {"choices":[{"delta":{"content":"你好"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"，"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"今天"}}]}\n\n',
        'data: [DONE]\n\n',
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: createSSEStream(sseChunks),
      });

      const receivedChunks = [];
      let done = false;

      await callLLMStream('mouth', 'hello', {}, (delta, isDone) => {
        if (isDone) { done = true; }
        else { receivedChunks.push(delta); }
      });

      expect(receivedChunks).toEqual(['你好', '，', '今天']);
      expect(done).toBe(true);
    });

    it('calls onChunk with isDone=true on [DONE]', async () => {
      const sseChunks = [
        'data: {"choices":[{"delta":{"content":"test"}}]}\n\n',
        'data: [DONE]\n\n',
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: createSSEStream(sseChunks),
      });

      let doneCalled = false;
      await callLLMStream('mouth', 'test', {}, (_delta, isDone) => {
        if (isDone) doneCalled = true;
      });

      expect(doneCalled).toBe(true);
    });

    it('throws on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      await expect(
        callLLMStream('mouth', 'test', {}, () => {})
      ).rejects.toThrow('MiniMax stream API error: 500');
    });

    it('sends stream: true in request body', async () => {
      const sseChunks = ['data: [DONE]\n\n'];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: createSSEStream(sseChunks),
      });

      await callLLMStream('mouth', 'test', {}, () => {});

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.stream).toBe(true);
    });
  });
});
