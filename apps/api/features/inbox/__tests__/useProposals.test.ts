import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useProposals, type Proposal } from '../hooks/useProposals';

// Keep both hooks real; replace only the browser's network boundaries.
class SocketBoundary {
  static instances: SocketBoundary[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(readonly url: string) { SocketBoundary.instances.push(this); }
  close() { this.onclose?.(); }
}
const network = vi.fn<typeof fetch>();
const pending: Proposal = {
  id: 'proposal-1', action_type: 'propose_decomposition', params: {}, context: {},
  status: 'pending_approval', created_at: '2026-11-09T00:00:00Z',
};
const approved: Proposal = { ...pending, id: 'proposal-2', status: 'approved' };

beforeEach(() => {
  network.mockReset();
  network.mockResolvedValue(Response.json({ success: true, actions: [pending, approved] }));
  SocketBoundary.instances = [];
  vi.stubGlobal('fetch', network);
  vi.stubGlobal('WebSocket', SocketBoundary);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function loaded() {
  const hook = renderHook(() => useProposals());
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

function message(data: unknown) {
  act(() => SocketBoundary.instances[0].onmessage?.({ data: JSON.stringify(data) } as MessageEvent));
}

describe('真实 useProposals 加载与错误状态', () => {
  it('挂载后显示加载状态，接收网络结果并仅计算待审批数量', async () => {
    let respond!: (response: Response) => void;
    network.mockReturnValueOnce(new Promise(resolve => { respond = resolve; }));
    const { result } = renderHook(() => useProposals());
    expect(result.current.loading).toBe(true);
    expect(result.current.proposals).toEqual([]);
    expect(network).toHaveBeenCalledWith('/api/brain/pending-actions');
    await act(async () => { respond(Response.json({ actions: [pending, approved] })); });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.proposals).toEqual([pending, approved]);
    expect(result.current.pendingCount).toBe(1);
    expect(result.current.error).toBeNull();
  });

  it('无 actions 时返回空列表，结束加载', async () => {
    network.mockResolvedValueOnce(Response.json({ success: true }));
    const { result } = await loaded();
    expect(result.current.proposals).toEqual([]);
    expect(result.current.pendingCount).toBe(0);
    expect(result.current.error).toBeNull();
  });

  it('HTTP失败形成可见错误，不把失败响应当成功数据', async () => {
    network.mockResolvedValueOnce(Response.json({ actions: [pending] }, { status: 503 }));
    const { result } = await loaded();
    expect(result.current.error).toContain('503');
    expect(result.current.proposals).toEqual([]);
  });

  it('fetch拒绝形成可见错误，刷新成功后恢复真实列表并清除错误', async () => {
    network.mockRejectedValueOnce(new Error('连接中断'));
    const { result } = await loaded();
    expect(result.current.error).toBe('连接中断');
    await act(async () => { await result.current.refresh(); });
    expect(result.current.error).toBeNull();
    expect(result.current.proposals.map(proposal => proposal.id)).toEqual(['proposal-1', 'proposal-2']);
    expect(result.current.pendingCount).toBe(1);
  });
});

describe('真实动作请求及消费后的状态', () => {
  it.each([
    { action: 'approve' as const, suffix: 'approve', body: undefined },
    { action: 'reject' as const, suffix: 'reject', body: { reason: '超出范围' } },
    { action: 'selectOption' as const, suffix: 'select', body: { option_id: 'option-2' } },
  ])('$action 成功提交对应接口并只移除目标提案', async ({ action, suffix, body }) => {
    const { result } = await loaded();
    network.mockResolvedValueOnce(Response.json({ success: true }));
    await act(async () => {
      if (action === 'approve') await result.current.approve('proposal-1');
      if (action === 'reject') await result.current.reject('proposal-1', '超出范围');
      if (action === 'selectOption') await result.current.selectOption('proposal-1', 'option-2');
    });
    const [, options] = network.mock.calls[1];
    expect(network.mock.calls[1][0]).toBe(`/api/brain/pending-actions/proposal-1/${suffix}`);
    expect(options?.method).toBe('POST');
    if (body) {
      expect(options?.headers).toEqual({ 'Content-Type': 'application/json' });
      expect(JSON.parse(String(options?.body))).toEqual(body);
    }
    expect(result.current.proposals.map(proposal => proposal.id)).toEqual(['proposal-2']);
    expect(result.current.pendingCount).toBe(0);
  });

  it.each(['approve', 'reject', 'selectOption', 'comment'] as const)(
    '%s HTTP失败向调用者报错并保留原有提案', async action => {
      const { result } = await loaded();
      network.mockResolvedValueOnce(Response.json({ error: '拒绝执行' }, { status: 409 }));
      await act(async () => {
        const operation = action === 'approve' ? result.current.approve('proposal-1')
          : action === 'reject' ? result.current.reject('proposal-1', '拒绝原因')
          : action === 'selectOption' ? result.current.selectOption('proposal-1', 'option-2')
          : result.current.comment('proposal-1', '补充条件');
        await expect(operation).rejects.toThrow('409');
      });
      expect(result.current.proposals).toEqual([pending, approved]);
      expect(result.current.pendingCount).toBe(1);
    }
  );

  it('评论把用户消息与服务回复追加到目标提案，保留已有评论及另一条提案', async () => {
    const previous = { role: 'system' as const, content: '原有条件', timestamp: '2026-11-09T00:00:00Z' };
    network.mockResolvedValueOnce(Response.json({ actions: [{ ...pending, comments: [previous] }, approved] }));
    const { result } = await loaded();
    const reply = { role: 'assistant' as const, content: '已调整', timestamp: '2026-11-09T01:00:00Z' };
    network.mockResolvedValueOnce(Response.json({ reply }));
    await act(async () => { expect(await result.current.comment('proposal-1', '补充条件')).toEqual(reply); });
    expect(network.mock.calls[1][0]).toBe('/api/brain/pending-actions/proposal-1/comment');
    expect(network.mock.calls[1][1]).toMatchObject({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"message":"补充条件"}' });
    expect(result.current.proposals[0].comments).toEqual([
      previous, { role: 'user', content: '补充条件', timestamp: expect.any(String) }, reply,
    ]);
    expect(result.current.proposals[1]).toEqual(approved);
  });
});

describe('真实WebSocket回调更新hook状态', () => {
  it('连接成功反映连接状态，created/comment/resolved事件更新同一提案列表', async () => {
    const { result } = await loaded();
    expect(result.current.wsConnected).toBe(false);
    expect(SocketBoundary.instances[0].url).toMatch(/\/api\/brain\/ws$/);
    act(() => SocketBoundary.instances[0].onopen?.());
    expect(result.current.wsConnected).toBe(true);
    const created = { ...pending, id: 'proposal-3' };
    message({ event: 'proposal:created', data: created });
    expect(result.current.proposals.map(proposal => proposal.id)).toEqual(['proposal-3', 'proposal-1', 'proposal-2']);
    expect(result.current.pendingCount).toBe(2);
    const comment = { role: 'assistant', content: '实时回复', timestamp: '2026-11-09T02:00:00Z' };
    message({ event: 'proposal:comment', data: { id: 'proposal-3', comment } });
    expect(result.current.proposals[0].comments).toEqual([comment]);
    expect(result.current.proposals[1].comments).toBeUndefined();
    message({ event: 'proposal:resolved', data: { id: 'proposal-3' } });
    expect(result.current.proposals).toEqual([pending, approved]);
    expect(result.current.pendingCount).toBe(1);
    act(() => SocketBoundary.instances[0].onmessage?.({ data: 'ping' } as MessageEvent));
    expect(result.current.proposals).toEqual([pending, approved]);
  });
});
