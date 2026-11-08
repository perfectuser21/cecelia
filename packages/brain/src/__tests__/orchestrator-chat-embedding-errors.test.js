import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({
  pool: { query: vi.fn() },
  embedding: vi.fn(),
  l1: vi.fn(),
  llm: vi.fn(),
  readManifest: vi.fn(),
  sideEffect: vi.fn(),
  memory: vi.fn(),
  profile: vi.fn(),
  selfModel: vi.fn(),
  resources: vi.fn(),
  createTask: vi.fn(() => { throw new Error('unexpected task creation'); }),
}));
vi.mock('../db.js', () => ({ default: boundary.pool }));
vi.mock('node:fs/promises', () => ({ readFile: boundary.readManifest }));
vi.mock('../actions.js', () => ({ createTask: boundary.createTask }));
vi.mock('../memory-retriever.js', () => ({ buildMemoryContext: boundary.memory, CHAT_TOKEN_BUDGET: 100 }));
vi.mock('../user-profile.js', () => ({
  extractAndSaveUserFacts: boundary.sideEffect, getUserProfileContext: boundary.profile,
}));
vi.mock('../llm-caller.js', () => ({ callLLM: boundary.llm }));
vi.mock('../self-model.js', () => ({ getSelfModel: boundary.selfModel }));
vi.mock('../memory-utils.js', () => ({
  generateL0Summary: text => text.slice(0, 20), generateMemoryStreamL1Async: boundary.l1,
}));
vi.mock('../embedding-service.js', () => ({ generateMemoryStreamEmbeddingAsync: boundary.embedding }));
vi.mock('../thalamus.js', () => ({ observeChat: boundary.sideEffect }));
vi.mock('../learning.js', () => ({ extractConversationLearning: boundary.sideEffect, upsertLearning: boundary.sideEffect }));
vi.mock('../person-model.js', () => ({ extractPersonSignals: boundary.sideEffect, detectAndStoreTaskInterest: boundary.sideEffect }));
vi.mock('../pending-conversations.js', () => ({ resolveByPersonReply: boundary.sideEffect }));
vi.mock('../fact-extractor.js', () => ({ processMessageFacts: boundary.sideEffect }));
vi.mock('../executor.js', () => ({ checkServerResources: boundary.resources }));

let handleChat;
let warn;
let unhandled;
let rejectionListener;
let fetchBoundary;
let memoryWrites;
let chatEvents;

async function settleEffects() {
  // Real Promise rejection handling crosses an event-loop turn; no fake clock or sleep.
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
}

beforeAll(async () => {
  ({ handleChat } = await import('../orchestrator-chat.js'));
});

beforeEach(() => {
  vi.clearAllMocks();
  memoryWrites = [];
  chatEvents = [];
  unhandled = [];
  rejectionListener = error => unhandled.push(String(error?.message ?? error));
  process.on('unhandledRejection', rejectionListener);
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  fetchBoundary = vi.fn(() => { throw new Error('unexpected network'); });
  vi.stubGlobal('fetch', fetchBoundary);

  boundary.resources.mockReturnValue({ metrics: { max_pressure: 0 } });
  boundary.llm.mockResolvedValue({ text: 'owned reply' });
  boundary.embedding.mockResolvedValue(undefined);
  boundary.l1.mockResolvedValue(undefined);
  boundary.sideEffect.mockResolvedValue(undefined);
  boundary.memory.mockResolvedValue({ block: '' });
  boundary.profile.mockResolvedValue('');
  boundary.selfModel.mockResolvedValue('');
  boundary.readManifest.mockImplementation(async url => {
    if (!(url instanceof URL) || !url.pathname.endsWith('/brain-manifest.generated.json')) {
      throw new Error('unexpected filesystem read');
    }
    return '{"allActions":[],"allSkills":[]}';
  });
  boundary.pool.query.mockImplementation(async (sql, params) => {
    const text = sql.trim().replace(/\s+/g, ' ');
    if (text.startsWith('INSERT INTO memory_stream')) {
      const id = memoryWrites.length === 0 ? 'owned-user-memory' : 'owned-reply-memory';
      memoryWrites.push({ id, sql: text, params });
      return { rows: [{ id }], rowCount: 1 };
    }
    if (text.startsWith('INSERT INTO cecelia_events')) {
      chatEvents.push({ type: params[0], payload: JSON.parse(params[2]) });
      return { rows: [], rowCount: 1 };
    }
    if (text.startsWith('SELECT') && /FROM (working_memory|desires|memory_stream|tasks|key_results|unified_conversations|feishu_users|pending_actions)\b/.test(text)) {
      return { rows: [], rowCount: 0 };
    }
    if (/^(INSERT INTO working_memory|INSERT INTO unified_conversations|UPDATE desires)\b/.test(text)) {
      return { rows: [], rowCount: 0 };
    }
    throw new Error(`unexpected record-only SQL: ${text}`);
  });
});

afterEach(async () => {
  try {
    await settleEffects();
    expect(fetchBoundary).not.toHaveBeenCalled();
    expect(boundary.createTask).not.toHaveBeenCalled();
  } finally {
    process.off('unhandledRejection', rejectionListener);
    vi.unstubAllGlobals();
    warn.mockRestore();
  }
});

describe('handleChat memory embedding failure isolation', () => {
  it.each([
    ['user', 'owned-user-memory'],
    ['reply', 'owned-reply-memory'],
  ])('%s embedding rejection does not reject chat or escape as unhandled', async (side, rejectedId) => {
    const failure = new Error(`owned ${side} embedding rejection`);
    boundary.embedding.mockImplementation(async id => {
      if (id === rejectedId) throw failure;
    });

    const result = await handleChat('owned message', {
      user_id: 'owned-user', sender_name: 'owned sender', conversation_id: 'owned-conversation',
    });
    await settleEffects();

    expect(result).toEqual({ reply: 'owned reply' });
    expect(memoryWrites).toHaveLength(2);
    expect(memoryWrites[0].params[0]).toBe('[用户对话] owned sender 说：owned message');
    expect(memoryWrites[1].params[0]).toBe('[对话回复] owned sender: owned message\nCecelia: owned reply');
    expect(boundary.embedding).toHaveBeenCalledTimes(2);
    for (const write of memoryWrites) {
      expect(boundary.embedding).toHaveBeenCalledWith(write.id, write.params[0], boundary.pool);
    }
    expect(chatEvents).toEqual([{
      type: 'orchestrator_chat',
      payload: { user_message: 'owned message', reply: 'owned reply', conversation_id: 'owned-conversation' },
    }]);
    expect(boundary.llm).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(`[orchestrator-chat] ${side} embedding failed:`, failure.message);
    expect(unhandled).toEqual([]);
  });

  it('successful embedding of both memory rows does not emit failure warnings', async () => {
    expect(await handleChat('owned message', { user_id: 'owned-user' })).toEqual({ reply: 'owned reply' });
    await settleEffects();
    expect(boundary.embedding).toHaveBeenCalledTimes(2);
    expect(memoryWrites).toHaveLength(2);
    expect(warn).not.toHaveBeenCalled();
    expect(unhandled).toEqual([]);
  });
});
