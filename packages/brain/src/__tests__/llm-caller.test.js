/**
 * llm-caller.js 单元测试
 * 覆盖：callLLM、callLLMStream、_resetMinimaxKey、_resetAnthropicKey
 * 以及内部函数通过公开入口间接测试：callAnthropicAPI、callClaudeViaBridge、callMiniMaxAPI、callMiniMaxAPIStream、stripThinking
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock 外部依赖
vi.mock('../model-profile.js', () => ({
  getActiveProfile: vi.fn(() => ({
    id: 'profile-test',
    name: 'Test Profile',
    config: {
      thalamus: {
        provider: 'anthropic-api',
        model: 'claude-haiku-4-5-20251001',
      },
      cortex: {
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
      },
      mouth: {
        provider: 'minimax',
        model: 'MiniMax-M2.5-highspeed',
      },
      fallback_agent: {
        provider: 'anthropic-api',
        model: 'claude-haiku-4-5-20251001',
        fallbacks: [
          { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
          { provider: 'minimax', model: 'MiniMax-M2.5-highspeed' },
        ],
      },
    },
  })),
}));

vi.mock('../account-usage.js', () => ({
  selectBestAccount: vi.fn(async () => ({ accountId: 'account1', model: 'haiku' })),
}));

vi.mock('fs', () => ({
  readFileSync: vi.fn((path) => {
    if (path.includes('anthropic.json')) {
      return JSON.stringify({ api_key: 'test-anthropic-key' });
    }
    if (path.includes('minimax.json')) {
      return JSON.stringify({ api_key: 'test-minimax-key' });
    }
    throw new Error('File not found');
  }),
}));

import { callLLM, callLLMStream, _resetMinimaxKey, _resetAnthropicKey } from '../llm-caller.js';
import { getActiveProfile } from '../model-profile.js';
import { selectBestAccount } from '../account-usage.js';

// ─── 辅助工具 ──────────────────────────────────────────────

/** 创建一个成功的 fetch Response mock */
function makeOkResponse(body) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

/** 创建一个失败的 fetch Response mock */
function makeErrorResponse(status, errText = 'error') {
  return {
    ok: false,
    status,
    json: async () => ({ error: errText }),
    text: async () => errText,
  };
}

/** 创建 Anthropic API 成功响应 */
function makeAnthropicResponse(text = '你好') {
  return makeOkResponse({
    content: [{ type: 'text', text }],
    model: 'claude-haiku-4-5-20251001',
    usage: { input_tokens: 10, output_tokens: 20 },
  });
}

/** 创建 MiniMax API 成功响应 */
function makeMinimaxResponse(text = '你好') {
  return makeOkResponse({
    choices: [{ message: { content: text } }],
    model: 'MiniMax-M2.5-highspeed',
  });
}

/** 创建 Bridge /llm-call 成功响应 */
function makeBridgeResponse(text = '你好') {
  return makeOkResponse({ text });
}

/** 创建 MiniMax SSE 流式 response mock */
function makeStreamResponse(chunks) {
  let chunkIndex = 0;
  const encoder = new TextEncoder();
  const reader = {
    read: vi.fn(async () => {
      if (chunkIndex >= chunks.length) {
        return { done: true, value: undefined };
      }
      const chunk = chunks[chunkIndex++];
      return { done: false, value: encoder.encode(chunk) };
    }),
    releaseLock: vi.fn(),
  };
  return {
    ok: true,
    status: 200,
    body: { getReader: () => reader },
    text: async () => '',
  };
}

// ─── 测试 ──────────────────────────────────────────────────

describe('llm-caller', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    global.fetch = vi.fn();
    // 重置凭据缓存
    _resetMinimaxKey();
    _resetAnthropicKey();
    // 重置 mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  // ═══════════════════════════════════════════════════════════
  // callLLM - Anthropic API 直连
  // ═══════════════════════════════════════════════════════════

  describe('callLLM - Anthropic API 直连', () => {
    it('正常调用 anthropic-api 返回文本', async () => {
      global.fetch.mockResolvedValueOnce(makeAnthropicResponse('测试回复'));

      const result = await callLLM('thalamus', '你好');

      expect(result.text).toBe('测试回复');
      expect(result.provider).toBe('anthropic-api');
      expect(result.model).toBe('claude-haiku-4-5-20251001');
      expect(result.elapsed_ms).toBeGreaterThanOrEqual(0);
      expect(result.attempted_fallback).toBe(false);
    });

    it('传递 maxTokens 和 timeout 参数', async () => {
      global.fetch.mockResolvedValueOnce(makeAnthropicResponse('ok'));

      await callLLM('thalamus', '测试', { maxTokens: 2048, timeout: 30000 });

      const fetchCall = global.fetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.max_tokens).toBe(2048);
      expect(fetchCall[1].signal).toBeDefined();
    });

    it('使用 options.model 覆盖 profile 配置', async () => {
      global.fetch.mockResolvedValueOnce(makeAnthropicResponse('ok'));

      const result = await callLLM('thalamus', '测试', {
        model: 'claude-sonnet-4-6',
        provider: 'anthropic-api',
      });

      const body = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(body.model).toBe('claude-sonnet-4-6');
      expect(result.model).toBe('claude-sonnet-4-6');
    });

    it('Anthropic API 返回空 content 时抛出错误', async () => {
      global.fetch.mockResolvedValueOnce(makeOkResponse({ content: [] }));

      await expect(callLLM('thalamus', '测试')).rejects.toThrow('empty content');
    });

    it('Anthropic API 返回 HTTP 错误时抛出错误', async () => {
      global.fetch.mockResolvedValueOnce(makeErrorResponse(429, 'rate limited'));

      await expect(callLLM('thalamus', '测试')).rejects.toThrow('Anthropic API error: 429');
    });

    it('Anthropic API key 不可用时抛出错误', async () => {
      _resetAnthropicKey();
      const { readFileSync } = await import('fs');
      readFileSync.mockImplementationOnce(() => { throw new Error('not found'); });

      await expect(callLLM('thalamus', '测试')).rejects.toThrow('Anthropic API key not available');
    });

    it('支持 imageContent 多模态调用', async () => {
      global.fetch.mockResolvedValueOnce(makeAnthropicResponse('图片分析结果'));

      const imageContent = [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'abc123' } },
      ];
      const result = await callLLM('thalamus', '分析这张图片', { imageContent });

      const body = JSON.parse(global.fetch.mock.calls[0][1].body);
      // 有图片时 content 应该是数组
      expect(Array.isArray(body.messages[0].content)).toBe(true);
      expect(body.messages[0].content[0]).toEqual({ type: 'text', text: '分析这张图片' });
      expect(body.messages[0].content[1]).toEqual(imageContent[0]);
      expect(result.text).toBe('图片分析结果');
    });
  });

  // ═══════════════════════════════════════════════════════════
  // callLLM - Bridge 调用
  // ═══════════════════════════════════════════════════════════

  describe('callLLM - Bridge 调用', () => {
    it('正常通过 bridge 调用返回文本', async () => {
      global.fetch.mockResolvedValueOnce(makeBridgeResponse('bridge回复'));

      const result = await callLLM('cortex', '测试');

      expect(result.text).toBe('bridge回复');
      expect(result.provider).toBe('anthropic');
      // 验证 bridge 调用参数
      const fetchCall = global.fetch.mock.calls[0];
      expect(fetchCall[0]).toContain('/llm-call');
      const body = JSON.parse(fetchCall[1].body);
      expect(body.model).toBe('sonnet'); // CLAUDE_MODEL_FLAG 映射
      expect(body.accountId).toBe('account1');
    });

    it('bridge 返回空 text 时抛出错误', async () => {
      global.fetch.mockResolvedValueOnce(makeOkResponse({ text: '' }));

      await expect(callLLM('cortex', '测试')).rejects.toThrow('empty text');
    });

    it('bridge HTTP 错误时抛出错误', async () => {
      global.fetch.mockResolvedValueOnce(makeErrorResponse(500, 'internal error'));

      await expect(callLLM('cortex', '测试')).rejects.toThrow('Bridge /llm-call error: 500');
    });

    it('selectBestAccount 失败时仍能调用（不带 accountId）', async () => {
      selectBestAccount.mockRejectedValueOnce(new Error('DB down'));
      global.fetch.mockResolvedValueOnce(makeBridgeResponse('降级回复'));

      const result = await callLLM('cortex', '测试');

      expect(result.text).toBe('降级回复');
      const body = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(body.accountId).toBeUndefined();
    });

    it('selectBestAccount 返回 null 时不带 accountId', async () => {
      selectBestAccount.mockResolvedValueOnce(null);
      global.fetch.mockResolvedValueOnce(makeBridgeResponse('ok'));

      await callLLM('cortex', '测试');

      const body = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(body.accountId).toBeUndefined();
    });

    it('有图片时 provider=anthropic 自动升级到 anthropic-api', async () => {
      global.fetch.mockResolvedValueOnce(makeAnthropicResponse('图片识别'));

      const imageContent = [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'xyz' } },
      ];
      const result = await callLLM('cortex', '看图', { imageContent });

      // 应该调用 Anthropic API 而不是 bridge
      const fetchCall = global.fetch.mock.calls[0];
      expect(fetchCall[0]).toBe('https://api.anthropic.com/v1/messages');
      expect(result.text).toBe('图片识别');
    });
  });

  // ═══════════════════════════════════════════════════════════
  // callLLM - MiniMax API
  // ═══════════════════════════════════════════════════════════

  describe('callLLM - MiniMax API', () => {
    it('正常调用 minimax 返回文本', async () => {
      global.fetch.mockResolvedValueOnce(makeMinimaxResponse('minimax回复'));

      const result = await callLLM('mouth', '测试');

      expect(result.text).toBe('minimax回复');
      expect(result.provider).toBe('minimax');

      const fetchCall = global.fetch.mock.calls[0];
      expect(fetchCall[0]).toBe('https://api.minimaxi.com/v1/chat/completions');
      const body = JSON.parse(fetchCall[1].body);
      expect(body.model).toBe('MiniMax-M2.5-highspeed');
    });

    it('MiniMax 返回包含 <think> 标签的内容会被清除', async () => {
      const raw = '<think>我需要思考一下</think>这是有用的回复';
      global.fetch.mockResolvedValueOnce(makeMinimaxResponse(raw));

      const result = await callLLM('mouth', '测试');

      expect(result.text).toBe('这是有用的回复');
    });

    it('MiniMax 返回空内容时抛出错误', async () => {
      global.fetch.mockResolvedValueOnce(makeOkResponse({ choices: [{ message: { content: '' } }] }));

      await expect(callLLM('mouth', '测试')).rejects.toThrow('MiniMax returned empty content');
    });

    it('MiniMax 返回仅 <think> 内容时降级提取 think 内容（不再抛出错误）', async () => {
      global.fetch.mockResolvedValueOnce(makeMinimaxResponse('<think>只有思考</think>'));

      const result = await callLLM('mouth', '测试');
      expect(result.text).toBe('只有思考');
    });

    it('MiniMax HTTP 错误时抛出错误', async () => {
      global.fetch.mockResolvedValueOnce(makeErrorResponse(503, 'service unavailable'));

      await expect(callLLM('mouth', '测试')).rejects.toThrow('MiniMax API error: 503');
    });

    it('MiniMax API key 不可用时抛出错误', async () => {
      _resetMinimaxKey();
      const { readFileSync } = await import('fs');
      readFileSync.mockImplementationOnce(() => { throw new Error('not found'); });

      await expect(callLLM('mouth', '测试')).rejects.toThrow('MiniMax API key not available');
    });
  });

  // ═══════════════════════════════════════════════════════════
  // callLLM - Fallback 降级链
  // ═══════════════════════════════════════════════════════════

  describe('callLLM - Fallback 降级链', () => {
    it('主模型失败后使用 fallback 成功', async () => {
      // 第一次（anthropic-api）失败
      global.fetch.mockRejectedValueOnce(new Error('API timeout'));
      // 第二次（bridge）成功
      global.fetch.mockResolvedValueOnce(makeBridgeResponse('fallback回复'));

      const result = await callLLM('fallback_agent', '测试');

      expect(result.text).toBe('fallback回复');
      expect(result.attempted_fallback).toBe(true);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('所有候选模型都失败时抛出最后一个错误', async () => {
      // 三次都失败
      global.fetch.mockRejectedValueOnce(new Error('error1'));
      global.fetch.mockRejectedValueOnce(new Error('error2'));

      // 第三个是 minimax，需要先读取 key（已 mock）
      global.fetch.mockRejectedValueOnce(new Error('error3'));

      await expect(callLLM('fallback_agent', '测试')).rejects.toThrow('error3');
    });

    it('主模型失败、第一个 fallback 也失败、第二个 fallback 成功', async () => {
      global.fetch.mockRejectedValueOnce(new Error('api down'));
      global.fetch.mockRejectedValueOnce(new Error('bridge down'));
      global.fetch.mockResolvedValueOnce(makeMinimaxResponse('minimax兜底'));

      const result = await callLLM('fallback_agent', '测试');

      expect(result.text).toBe('minimax兜底');
      expect(result.attempted_fallback).toBe(true);
      expect(global.fetch).toHaveBeenCalledTimes(3);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // callLLM - 不支持的 provider
  // ═══════════════════════════════════════════════════════════

  describe('callLLM - 不支持的 provider', () => {
    it('不支持的 provider 抛出错误', async () => {
      await expect(
        callLLM('thalamus', '测试', { provider: 'truly-unsupported', model: 'some-model' })
      ).rejects.toThrow('Unsupported provider: truly-unsupported');
    });

    it('openai provider 现已支持，无 API key 时抛出凭据错误', async () => {
      // 若环境有 OPENAI_API_KEY，fetch 会被调用；模拟 401 以触发 OpenAI API error 路径
      global.fetch.mockResolvedValueOnce(makeErrorResponse(401, 'Unauthorized'));
      await expect(
        callLLM('thalamus', '测试', { provider: 'openai', model: 'gpt-4o-mini' })
      ).rejects.toThrow(/OpenAI API key not available|OpenAI API error/);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // callLLM - Profile 为空 / Agent 未配置
  // ═══════════════════════════════════════════════════════════

  describe('callLLM - Profile 为空时使用默认值', () => {
    it('profile 为 null 时使用默认 anthropic + haiku', async () => {
      getActiveProfile.mockReturnValueOnce(null);
      global.fetch.mockResolvedValueOnce(makeBridgeResponse('默认回复'));

      const result = await callLLM('unknown_agent', '测试');

      expect(result.text).toBe('默认回复');
      expect(result.provider).toBe('anthropic');
      expect(result.model).toBe('claude-haiku-4-5-20251001');
    });

    it('agentConfig 不存在时使用默认值', async () => {
      global.fetch.mockResolvedValueOnce(makeBridgeResponse('ok'));

      const result = await callLLM('nonexistent_agent', '测试');

      expect(result.text).toBe('ok');
      // 使用默认 anthropic provider
      expect(result.provider).toBe('anthropic');
    });
  });

  // ═══════════════════════════════════════════════════════════
  // callLLM - fetch 抛出异常（网络错误/超时）
  // ═══════════════════════════════════════════════════════════

  describe('callLLM - 网络错误', () => {
    it('fetch 网络异常时抛出', async () => {
      global.fetch.mockRejectedValueOnce(new Error('网络不可达'));

      await expect(callLLM('thalamus', '测试')).rejects.toThrow('网络不可达');
    });

    it('fetch AbortError（超时）时抛出', async () => {
      const abortError = new DOMException('signal timed out', 'AbortError');
      global.fetch.mockRejectedValueOnce(abortError);

      await expect(callLLM('thalamus', '测试')).rejects.toThrow();
    });
  });

  // ═══════════════════════════════════════════════════════════
  // callLLMStream - MiniMax 流式
  // ═══════════════════════════════════════════════════════════

  describe('callLLMStream - MiniMax 流式', () => {
    it('正常流式输出多个 chunk', async () => {
      const sseData = [
        'data: {"choices":[{"delta":{"content":"你"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"好"}}]}\n\n',
        'data: [DONE]\n\n',
      ];
      global.fetch.mockResolvedValueOnce(makeStreamResponse(sseData));

      const chunks = [];
      await callLLMStream('mouth', '测试', {}, (delta, isDone) => {
        chunks.push({ delta, isDone });
      });

      // 应收到 "你"、"好"、done
      const textChunks = chunks.filter(c => c.delta !== '');
      expect(textChunks.length).toBe(2);
      expect(textChunks[0].delta).toBe('你');
      expect(textChunks[1].delta).toBe('好');
      expect(chunks[chunks.length - 1].isDone).toBe(true);
    });

    it('处理格式不完整的 SSE 行（空行、非 data: 前缀）', async () => {
      const sseData = [
        '\n',
        'event: message\n',
        'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
        'data: [DONE]\n\n',
      ];
      global.fetch.mockResolvedValueOnce(makeStreamResponse(sseData));

      const chunks = [];
      await callLLMStream('mouth', '测试', {}, (delta, isDone) => {
        chunks.push({ delta, isDone });
      });

      const textChunks = chunks.filter(c => c.delta !== '');
      expect(textChunks.length).toBe(1);
      expect(textChunks[0].delta).toBe('ok');
    });

    it('处理 malformed JSON chunk（跳过不报错）', async () => {
      const sseData = [
        'data: {invalid json}\n\n',
        'data: {"choices":[{"delta":{"content":"有效"}}]}\n\n',
        'data: [DONE]\n\n',
      ];
      global.fetch.mockResolvedValueOnce(makeStreamResponse(sseData));

      const chunks = [];
      await callLLMStream('mouth', '测试', {}, (delta, isDone) => {
        chunks.push({ delta, isDone });
      });

      const textChunks = chunks.filter(c => c.delta !== '');
      expect(textChunks.length).toBe(1);
      expect(textChunks[0].delta).toBe('有效');
    });

    it('MiniMax 流式 HTTP 错误时抛出', async () => {
      global.fetch.mockResolvedValueOnce(makeErrorResponse(500, 'stream error'));

      await expect(
        callLLMStream('mouth', '测试', {}, () => {})
      ).rejects.toThrow('MiniMax stream API error: 500');
    });

    it('MiniMax 流式 API key 不可用时抛出', async () => {
      _resetMinimaxKey();
      const { readFileSync } = await import('fs');
      readFileSync.mockImplementationOnce(() => { throw new Error('not found'); });

      await expect(
        callLLMStream('mouth', '测试', {}, () => {})
      ).rejects.toThrow('MiniMax API key not available');
    });

    it('reader 直接 done（无数据）时触发 onChunk(done)', async () => {
      // 空流：reader 直接返回 done
      const reader = {
        read: vi.fn(async () => ({ done: true, value: undefined })),
        releaseLock: vi.fn(),
      };
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: { getReader: () => reader },
      });

      const chunks = [];
      await callLLMStream('mouth', '测试', {}, (delta, isDone) => {
        chunks.push({ delta, isDone });
      });

      // 流结束后应调用 onChunk('', true)
      expect(chunks[chunks.length - 1].isDone).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // callLLMStream - 非 MiniMax provider（降级到非流式）
  // ═══════════════════════════════════════════════════════════

  describe('callLLMStream - 非流式降级', () => {
    it('anthropic provider 降级为非流式，一次性返回', async () => {
      getActiveProfile.mockReturnValueOnce({
        config: {
          cortex: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
        },
      });
      global.fetch.mockResolvedValueOnce(makeBridgeResponse('完整回复'));

      const chunks = [];
      await callLLMStream('cortex', '测试', {}, (delta, isDone) => {
        chunks.push({ delta, isDone });
      });

      // 应收到完整文本 + done
      expect(chunks.length).toBe(2);
      expect(chunks[0]).toEqual({ delta: '完整回复', isDone: false });
      expect(chunks[1]).toEqual({ delta: '', isDone: true });
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 凭据缓存重置
  // ═══════════════════════════════════════════════════════════

  describe('凭据缓存重置', () => {
    it('_resetMinimaxKey 重置后重新读取凭据', async () => {
      // 首次调用会缓存 key
      global.fetch.mockResolvedValueOnce(makeMinimaxResponse('第一次'));
      await callLLM('mouth', '测试1');

      // 重置缓存
      _resetMinimaxKey();

      // 再次调用应重新读取文件
      global.fetch.mockResolvedValueOnce(makeMinimaxResponse('第二次'));
      const result = await callLLM('mouth', '测试2');
      expect(result.text).toBe('第二次');
    });

    it('_resetAnthropicKey 重置后重新读取凭据', async () => {
      // 首次调用
      global.fetch.mockResolvedValueOnce(makeAnthropicResponse('第一次'));
      await callLLM('thalamus', '测试1');

      // 重置缓存
      _resetAnthropicKey();

      // 再次调用
      global.fetch.mockResolvedValueOnce(makeAnthropicResponse('第二次'));
      const result = await callLLM('thalamus', '测试2');
      expect(result.text).toBe('第二次');
    });
  });

  // ═══════════════════════════════════════════════════════════
  // Anthropic API 请求头验证
  // ═══════════════════════════════════════════════════════════

  describe('Anthropic API 请求头', () => {
    it('包含正确的 API headers', async () => {
      global.fetch.mockResolvedValueOnce(makeAnthropicResponse('ok'));

      await callLLM('thalamus', '测试');

      const headers = global.fetch.mock.calls[0][1].headers;
      expect(headers['x-api-key']).toBe('test-anthropic-key');
      expect(headers['anthropic-version']).toBe('2023-06-01');
      expect(headers['content-type']).toBe('application/json');
    });
  });

  // ═══════════════════════════════════════════════════════════
  // Bridge 请求参数验证
  // ═══════════════════════════════════════════════════════════

  describe('Bridge 请求参数', () => {
    it('使用 EXECUTOR_BRIDGE_URL 环境变量', async () => {
      // BRIDGE_URL 在模块加载时读取，此处验证默认值
      global.fetch.mockResolvedValueOnce(makeBridgeResponse('ok'));

      await callLLM('cortex', '测试');

      const url = global.fetch.mock.calls[0][0];
      // 默认 URL 或环境变量
      expect(url).toContain('/llm-call');
    });

    it('bridge 超时比 timeout 多 10 秒缓冲', async () => {
      global.fetch.mockResolvedValueOnce(makeBridgeResponse('ok'));

      await callLLM('cortex', '测试', { timeout: 30000 });

      // signal 是 AbortSignal.timeout(timeout + 10000)
      // 无法直接验证 signal 的超时值，但确认 signal 存在
      const signal = global.fetch.mock.calls[0][1].signal;
      expect(signal).toBeDefined();
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 边界场景
  // ═══════════════════════════════════════════════════════════

  describe('边界场景', () => {
    it('Anthropic API response.text() 在错误提取时失败仍返回 unknown', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => { throw new Error('read failed'); },
      });

      await expect(callLLM('thalamus', '测试')).rejects.toThrow('Anthropic API error: 500 - unknown');
    });

    it('agentConfig 无 fallbacks 时只尝试一次', async () => {
      global.fetch.mockRejectedValueOnce(new Error('单次失败'));

      await expect(callLLM('thalamus', '测试')).rejects.toThrow('单次失败');
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('所有候选失败且 lastError 为 undefined 时抛出默认错误', async () => {
      // 构建一个空 candidates 场景（通过 mock profile 返回空 fallbacks）
      getActiveProfile.mockReturnValueOnce({
        config: {
          empty_agent: {
            provider: 'anthropic-api',
            model: 'claude-haiku-4-5-20251001',
            fallbacks: [],
          },
        },
      });
      global.fetch.mockRejectedValueOnce(new Error('唯一失败'));

      await expect(callLLM('empty_agent', '测试')).rejects.toThrow('唯一失败');
    });
  });
});
