/**
 * llm-caller-claude-direct-stream.test.js
 *
 * Regression test：SSE 聊天无回复 bug（"创建Skill Tab" 员工发消息 AI 不回复）
 *
 * 根因：
 * 1. mmv 默认 claude 账号 OAuth 过期，callLLMStream Anthropic 路径未用 account1/2 池
 * 2. callLLMStream Anthropic fallback 通过 bridge（非流式），bridge 在 mmv 可能未启动/OAuth 失效
 * 3. 新增 callClaudeDirectStream：spawn claude --output-format stream-json，
 *    正确解析嵌套 NDJSON：{type:'assistant',message:{content:[{type:'text',text}]}}
 *    而非平铺的 {type:'text',text}（后者永远不会出现在 stream-json 输出里）
 *
 * 本测试永久留在 CI 中作为回归测试。
 */

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { EventEmitter } from 'events';

// ─── Mock 依赖（全用 vi.hoisted，避免 "before initialization" 错误）────────────

const mockSelectBestAccount = vi.hoisted(() => vi.fn());
const mockMarkAuthFailure = vi.hoisted(() => vi.fn());
const mockVerifyAccountTokenLive = vi.hoisted(() => vi.fn());

vi.mock('../account-usage.js', () => ({
  selectBestAccount: mockSelectBestAccount,
  markAuthFailure: mockMarkAuthFailure,
  verifyAccountTokenLive: mockVerifyAccountTokenLive,
  isSpendingCapped: vi.fn(),
}));

vi.mock('../model-profile.js', () => ({
  getActiveProfile: vi.fn().mockReturnValue({
    config: {
      mouth: { model: 'claude-haiku-4-5-20251001', provider: 'anthropic' },
    },
  }),
}));

vi.mock('fs', () => ({
  readFileSync: vi.fn().mockReturnValue(JSON.stringify({ api_key: 'test-key' })),
  existsSync: vi.fn().mockReturnValue(true),
}));

vi.mock('../langfuse-reporter.js', () => ({
  reportCall: vi.fn(),
}));

// Mock child_process.spawn — 实例在 beforeEach 里创建
const mockSpawn = vi.hoisted(() => vi.fn());
vi.mock('child_process', () => ({ spawn: mockSpawn }));

// Mock fetch（bridge fallback 路径用，本测试走 direct spawn 不应调 bridge）
const mockFetch = vi.hoisted(() => vi.fn());
vi.stubGlobal('fetch', mockFetch);

afterAll(() => {
  vi.unstubAllGlobals();
});

import { callLLMStream } from '../llm-caller.js';

// ─── 测试辅助：创建假的 child_process + 推 NDJSON 行 ─────────────────────────

let mockProcess;

function createMockProcess() {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  return proc;
}

/**
 * 模拟 spawn 推送 NDJSON 行，然后 close 进程
 */
function pushNDJSONAndClose(lines, exitCode = 0) {
  setImmediate(() => {
    for (const line of lines) {
      mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(line) + '\n'));
    }
    mockProcess.stdout.emit('end');
    mockProcess.emit('close', exitCode);
  });
}

describe('callLLMStream — anthropic provider 直接 spawn claude --output-format stream-json', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // 每个测试创建新的 mock 进程
    mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);

    // 默认：selectBestAccount 选 account1
    mockSelectBestAccount.mockResolvedValue({ accountId: 'account1', model: 'claude-haiku-4-5-20251001' });
  });

  it('【根因1】调用 selectBestAccount() 选账号，而不是使用过期默认账号', async () => {
    pushNDJSONAndClose([
      { type: 'assistant', message: { content: [{ type: 'text', text: '你好' }] } },
      { type: 'result', subtype: 'success' },
    ]);

    await callLLMStream('mouth', '你好', {}, () => {});

    expect(mockSelectBestAccount).toHaveBeenCalledOnce();
  });

  it('【根因1】selectBestAccount 返回 account2 时，spawn 使用 ~/.claude-account2 配置目录', async () => {
    mockSelectBestAccount.mockResolvedValue({ accountId: 'account2', model: 'claude-haiku-4-5-20251001' });

    pushNDJSONAndClose([
      { type: 'assistant', message: { content: [{ type: 'text', text: '回复' }] } },
      { type: 'result', subtype: 'success' },
    ]);

    await callLLMStream('mouth', '测试', {}, () => {});

    const spawnEnv = mockSpawn.mock.calls[0][2]?.env || {};
    expect(spawnEnv.CLAUDE_CONFIG_DIR).toMatch(/\.claude-account2$/);
  });

  it('【根因2】正确解析嵌套 NDJSON，提取 message.content[].text', async () => {
    const chunks = [];
    let doneFired = false;

    pushNDJSONAndClose([
      { type: 'assistant', message: { content: [{ type: 'text', text: '你' }] } },
      { type: 'assistant', message: { content: [{ type: 'text', text: '好' }] } },
      { type: 'assistant', message: { content: [{ type: 'text', text: '！' }] } },
      { type: 'result', subtype: 'success' },
    ]);

    await callLLMStream('mouth', '打个招呼', {}, (delta, isDone) => {
      if (isDone) doneFired = true;
      else chunks.push(delta);
    });

    expect(chunks).toEqual(['你', '好', '！']);
    expect(doneFired).toBe(true);
  });

  it('【根因2 反例】平铺格式 {type:text,text} 不是 stream-json 真实格式，不产生内容 chunk', async () => {
    // stream-json 输出不含平铺的 {type:'text',text:'...'} 行
    // 旧代码用此格式 mock 测试，所以从未验证真实输出
    const chunks = [];

    pushNDJSONAndClose([
      { type: 'text', text: '这行不应被解析为内容' },
      { type: 'result', subtype: 'success' },
    ]);

    await callLLMStream('mouth', '测试', {}, (delta, isDone) => {
      if (!isDone) chunks.push(delta);
    });

    expect(chunks).toEqual([]);
  });

  it('content 数组含多个 text block 时全部输出', async () => {
    const chunks = [];

    pushNDJSONAndClose([
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: '第一段' },
            { type: 'text', text: '第二段' },
          ],
        },
      },
      { type: 'result', subtype: 'success' },
    ]);

    await callLLMStream('mouth', '测试', {}, (delta, isDone) => {
      if (!isDone) chunks.push(delta);
    });

    expect(chunks).toContain('第一段');
    expect(chunks).toContain('第二段');
  });

  it('spawn 进程以非 0 退出码退出时，调用 onChunk isDone=true（容错）', async () => {
    setImmediate(() => {
      mockProcess.stderr.emit('data', Buffer.from('OAuth token expired'));
      mockProcess.emit('close', 1);
    });

    let doneFired = false;
    // 非 0 退出码应当拒绝（抛出）或者至少触发 isDone
    // 这里测试它不会永远挂起
    const p = callLLMStream('mouth', '测试', {}, (_delta, isDone) => {
      if (isDone) doneFired = true;
    });

    await expect(p).rejects.toThrow();
  });

  it('spawn 时使用 --output-format stream-json 参数', async () => {
    pushNDJSONAndClose([
      { type: 'assistant', message: { content: [{ type: 'text', text: 'ok' }] } },
      { type: 'result', subtype: 'success' },
    ]);

    await callLLMStream('mouth', '测试', {}, () => {});

    const spawnArgs = mockSpawn.mock.calls[0][1];
    expect(spawnArgs).toContain('--output-format');
    expect(spawnArgs).toContain('stream-json');
  });

  it('anthropic provider 不走 bridge（不调 fetch）', async () => {
    pushNDJSONAndClose([
      { type: 'assistant', message: { content: [{ type: 'text', text: '直接流式' }] } },
      { type: 'result', subtype: 'success' },
    ]);

    await callLLMStream('mouth', '测试', {}, () => {});

    expect(mockFetch).not.toHaveBeenCalled();
  });
});
