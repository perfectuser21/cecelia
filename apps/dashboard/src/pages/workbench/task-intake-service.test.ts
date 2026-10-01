import { afterEach, describe, expect, it, vi } from 'vitest';
import { newSourceId, submitIntake, loadPending, readTasks, readTask } from '@features/core/workbench/task-desk/service';
afterEach(() => vi.unstubAllGlobals());
describe('接单边界', () => {
  it('HTTP环境没有randomUUID时使用安全随机数生成UUID', () => {
    const random = vi.fn((bytes: Uint8Array) => { bytes.fill(13); return bytes; });
    vi.stubGlobal('crypto', { getRandomValues: random });
    expect(newSourceId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(random).toHaveBeenCalledTimes(1);
  });
  it('无安全随机数时明确阻止提交', () => {
    vi.stubGlobal('crypto', undefined);
    expect(newSourceId).toThrow('无法生成安全');
  });
  it('错误source回执或普通消息ID不能当成接单成功', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ outcome: 'created', source_id: 'wrong', task_id: 'message-1', task: { id: 'message-1' } })));
    await expect(submitIntake({ text: '调研', source_id: 'correct' })).rejects.toThrow('未收到有效');
  });
  it.each(['network', 'non-json'])('读取失败%s统一中文提示', async failure => {
    if (failure === 'network') vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'));
    else vi.mocked(fetch).mockImplementation(async () => new Response('<html>bad gateway</html>'));
    await expect(readTasks(new AbortController().signal)).rejects.toThrow('最近交办读取失败');
    await expect(readTask('a73a7e69-5b08-460f-a290-8f8371403ac8', new AbortController().signal)).rejects.toThrow('任务详情读取失败');
  });
  it('读取主动取消仍保留AbortError', async () => {
    vi.mocked(fetch).mockRejectedValue(new DOMException('取消', 'AbortError'));
    await expect(readTasks(new AbortController().signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('存储不可读返回阻塞说明，渲染不会抛异常', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error(); } });
    expect(loadPending()).toMatchObject({ pending: null, error: expect.stringContaining('无法读取') });
  });
});
