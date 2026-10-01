import { beforeAll, describe, expect, it, vi } from 'vitest';

let createTaskIntake;
beforeAll(async () => {
  ({ createTaskIntake } = await import('../task-intake.js').catch(() => ({})));
  expect(createTaskIntake, '必须提供一句话交办服务').toBeTypeOf('function');
});

const facts = {
  repositories: [{ repo: 'cecelia', scope_key: 'cecelia', aliases: ['perfectuser21/cecelia'] }],
  mapNodes: [{ repo: 'cecelia', node_key: 'F1', name: '任务接单' }],
};
const input = { text: '调研任务接单的设计方案', source_id: 'message-1' };
function candidate(text = input.text, patch = {}) {
  return {
    intent: 'research', title: '调研任务接单设计', objective: text,
    mutation_intent: 'read_only', change_kind: null, repo: null,
    map_scope: [], confidence: 0.95, evidence: [text], questions: [], ...patch,
  };
}
function fixture(output = candidate(), options = {}) {
  const client = { query: vi.fn(async () => ({ rows: [] })), release: vi.fn() };
  const db = { query: vi.fn(async () => ({ rows: [] })), connect: vi.fn(async () => client) };
  const callLLM = vi.fn(async () => ({ text: JSON.stringify(output) }));
  const createRoutedTask = vi.fn(async (_db, request) => ({
    task_id: 'task-1', routing_receipt_id: 'receipt-1',
    task: { id: 'task-1', title: request.title, status: 'queued' },
  }));
  const intake = createTaskIntake({ db, callLLM, createRoutedTask,
    loadFacts: vi.fn(async () => facts), ...options });
  return { intake, db, client, callLLM, createRoutedTask };
}

describe('一句话交办候选验证', () => {
  it.each([
    ['research', '调研任务接单的设计方案', 'read_only', null, null, [], 'research'],
    ['code_review', '审查 Cecelia 接单代码，只给建议，不修改', 'read_only', null, 'cecelia', ['F1'], 'code_review'],
    ['coding_change', '修复 Cecelia 接单重复创建任务的问题', 'write', 'bugfix', 'cecelia', ['F1'], undefined],
  ])('只允许程序构造 %s 的路由请求', async (intent, text, mutation, change, repo, scope, type) => {
    const f = fixture(candidate(text, { intent, mutation_intent: mutation,
      change_kind: change, repo, map_scope: scope }));
    const result = await f.intake({ text, source_id: 'one' }, { tenantId: 'team-a' });
    expect(result).toMatchObject({ status: 201, body: {
      outcome: 'created', source_id: 'one', task_id: 'task-1', deduplicated: false,
      task: { id: 'task-1', status: 'queued' },
    } });
    const [client, request, repositories, tx] = f.createRoutedTask.mock.calls[0];
    expect(client).toBe(f.client);
    expect(repositories).toEqual(facts.repositories);
    expect(tx).toMatchObject({ transaction: 'existing' });
    expect(request).toMatchObject({ source: 'api', mutation_intent: mutation,
      declared_change_kind: change, requested_task_type: type,
      description: expect.stringContaining(text), task: {
        payload: { tenant_id: 'team-a', intake: { text, fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/) } },
      },
    });
    expect(request.source_id).toContain('dashboard:');
    if (intent === 'research') expect(request.declared_domain).toBe('research');
    expect(f.callLLM).toHaveBeenCalledWith('thalamus', expect.stringContaining('F1'),
      expect.objectContaining({ timeout: expect.any(Number), maxTokens: expect.any(Number) }));
    expect(f.client.query.mock.calls.map(([sql]) => sql)).toContain('COMMIT');
    expect(f.client.release).toHaveBeenCalledOnce();
  });

  it.each(['repo', 'repo_hint', 'map_scope', 'task_type', 'executor', 'payload', 'tenant_id', 'source'])('拒绝客户端注入 %s', async (key) => {
    const f = fixture();
    expect(await f.intake({ ...input, [key]: '伪造' })).toMatchObject({ status: 400 });
    expect(f.callLLM).not.toHaveBeenCalled();
    expect(f.createRoutedTask).not.toHaveBeenCalled();
  });

  it.each([
    { text: '', source_id: 'x' }, { text: '任务' }, { text: 42, source_id: 'x' },
    { ...input, answers: [] }, { ...input, answers: { q: { executor: 'codex' } } },
  ])('拒绝非法输入 %j', async (body) => {
    const f = fixture();
    expect(await f.intake(body)).toMatchObject({ status: 400 });
    expect(f.callLLM).not.toHaveBeenCalled();
  });

  it.each([
    { confidence: 2 }, { confidence: -1 }, { confidence: null },
    { mutation_intent: 'none' }, { intent: 'dev' }, { change_kind: 'delete' },
    { repo: '幻觉仓库' }, { repo: 'cecelia', map_scope: ['F999'] },
    { evidence: ['原话中不存在的授权'] }, { executor: 'codex' },
    { questions: [{ id: 'x', prompt: '问题', executor: 'codex' }] },
  ])('模型契约失败不是用户澄清 %j', async (patch) => {
    const f = fixture(candidate(input.text, patch));
    expect(await f.intake(input)).toMatchObject({ status: 502, body: { error: 'invalid_model_contract' } });
    expect(f.createRoutedTask).not.toHaveBeenCalled();
  });

  it('非法模型JSON返回502', async () => {
    const f = fixture();
    f.callLLM.mockResolvedValue({ text: '这不是JSON' });
    expect(await f.intake(input)).toMatchObject({ status: 502 });
  });
  it('模型不可用返回503', async () => {
    const f = fixture();
    f.callLLM.mockRejectedValue(new Error('provider unavailable'));
    expect(await f.intake(input)).toMatchObject({ status: 503, body: { error: 'model_unavailable' } });
  });

  it.each([
    [input.text, { confidence: 0.4 }],
    [input.text, { mutation_intent: 'unknown' }],
    ['检查并修复 Cecelia 接单问题', {}],
    ['只审查 Cecelia 接单代码，不要修改', { intent: 'coding_change', mutation_intent: 'write', change_kind: 'bugfix', repo: 'cecelia', map_scope: ['F1'] }],
    ['调研接单方案并修复重复提交', {}],
    ['修复 Cecelia 接单问题', { intent: 'coding_change', mutation_intent: 'write', change_kind: null, repo: null }],
    ['优化一下这个', { intent: 'clarify', mutation_intent: 'unknown', questions: [{ id: 'goal', prompt: '希望改善哪一项体验？' }] }],
  ])('歧义或矛盾只问人话：%s', async (text, patch) => {
    const f = fixture(candidate(text, patch));
    const result = await f.intake({ text, source_id: 'one' });
    expect(result).toMatchObject({ status: 200, body: { outcome: 'clarification_required', task_id: null } });
    expect(result.body.questions.length).toBeGreaterThan(0);
    expect(JSON.stringify(result.body.questions)).not.toMatch(/repo|map_scope|executor/);
    expect(f.createRoutedTask).not.toHaveBeenCalled();
  });

  it.each(['把内容发布到抖音', '删除生产数据库中的数据', '重启生产服务器', '修改生产防火墙规则'])('无执行适配器不能转研究：%s', async (text) => {
    const f = fixture(candidate(text));
    expect(await f.intake({ text, source_id: 'one' })).toMatchObject({ status: 422, body: { error: 'unsupported_execution', task_id: null } });
    expect(f.createRoutedTask).not.toHaveBeenCalled();
  });
  it('模型识别的不支持执行即使无关键词也不能建单', async () => {
    const text = '把今天的内容送到大家眼前';
    const f = fixture(candidate(text, { intent: 'unsupported' }));
    expect(await f.intake({ text, source_id: 'one' })).toMatchObject({ status: 422 });
  });
});

describe('成功收据与事务', () => {
  it('同内容重放返回真实任务且不重新调用模型', async () => {
    const f = fixture();
    await f.intake(input);
    const request = f.createRoutedTask.mock.calls[0][1];
    f.db.query.mockResolvedValue({ rows: [{ id: 'persisted-id', title: '原任务', status: 'completed', payload: request.task.payload }] });
    f.callLLM.mockClear();
    expect(await f.intake(input)).toMatchObject({ status: 200, body: {
      outcome: 'created', task_id: 'persisted-id', deduplicated: true, task: { status: 'completed' },
    } });
    expect(f.callLLM).not.toHaveBeenCalled();
  });
  it('成功后同key不同内容409', async () => {
    const f = fixture();
    await f.intake(input);
    f.db.query.mockResolvedValue({ rows: [{ id: 'old', payload: f.createRoutedTask.mock.calls[0][1].task.payload }] });
    expect(await f.intake({ ...input, text: '另一项任务' })).toMatchObject({ status: 409 });
    expect(f.callLLM).toHaveBeenCalledOnce();
  });
  it('事务锁下再次查到成功收据时不重复物化', async () => {
    const f = fixture();
    await f.intake(input);
    const payload = f.createRoutedTask.mock.calls[0][1].task.payload;
    f.createRoutedTask.mockClear();
    f.client.query.mockImplementation(async (sql) => ({ rows: String(sql).includes('JOIN tasks')
      ? [{ id: 'concurrent-id', status: 'queued', title: '并发任务', payload }] : [] }));
    expect(await f.intake(input)).toMatchObject({ status: 200, body: { task_id: 'concurrent-id', deduplicated: true } });
    expect(f.createRoutedTask).not.toHaveBeenCalled();
    expect(f.client.query.mock.calls.some(([sql, args]) => sql.includes('pg_advisory_xact_lock')
      && args[0].startsWith('work-route:api:dashboard:'))).toBe(true);
  });
  it('收据写入失败会回滚释放连接，不能返回task_id', async () => {
    const f = fixture();
    f.createRoutedTask.mockRejectedValue(new Error('receipt insert failed'));
    const result = await f.intake(input);
    expect(result).toMatchObject({ status: 503, body: { task_id: null } });
    expect(f.client.query.mock.calls.map(([sql]) => sql)).toContain('ROLLBACK');
    expect(f.client.query.mock.calls.map(([sql]) => sql)).not.toContain('COMMIT');
    expect(f.client.release).toHaveBeenCalledOnce();
  });
  it('不同租户source_id使用互不碰撞的幂等空间', async () => {
    const f = fixture();
    await f.intake(input, { tenantId: 'a' });
    await f.intake(input, { tenantId: 'b' });
    const requests = f.createRoutedTask.mock.calls.map((call) => call[1]);
    expect(requests[0].source_id).not.toBe(requests[1].source_id);
  });
  it('澄清不建单，同source_id补answers后可以创建', async () => {
    const text = '帮我看看接单';
    const f = fixture(candidate(text, { intent: 'clarify', confidence: 0.5 }));
    expect(await f.intake({ text, source_id: 'one' })).toMatchObject({ body: { task_id: null } });
    f.callLLM.mockResolvedValue({ text: JSON.stringify(candidate(text)) });
    const result = await f.intake({ text, source_id: 'one', answers: { goal: '仅调研设计方案' } });
    expect(result.status).toBe(201);
    expect(f.createRoutedTask.mock.calls[0][1].description).toContain('仅调研设计方案');
  });
});
