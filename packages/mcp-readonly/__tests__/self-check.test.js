import { describe, it, expect, vi } from 'vitest';
import { assertReadonly } from '../src/self-check.js';

// 背景（详见 src/self-check.js 顶部注释）：assertReadonly() 最初的参考实现是靠
// "真的 INSERT 一下、期待它报权限不足"来探测，实测发现这个思路有两个真实缺陷——
// DO 块里不能 ROLLBACK（语法错误），以及"建自己的临时表再写它"因为 table owner
// 天然有全部权限，永远测不出账号是不是真的只读。改成查 has_table_privilege() 的
// 布尔结果后，queryFn 的契约变成："返回 {rows:[{can_write: boolean}]}" 代表探测本身
// 成功、can_write 是真实的权限判定结果；"queryFn 抛错"则一律代表探测本身失败
// （连接问题/语法错误等意外情况），不再需要靠字符串/错误码去猜"这个异常算不算
// 预期的权限不足"——预期结果已经通过返回值表达，不再需要靠异常表达。
describe('assertReadonly', () => {
  it('账号确实只读（has_table_privilege 返回 can_write=false）时通过自检', async () => {
    const fakeQuery = vi.fn().mockResolvedValue({ rows: [{ can_write: false }] });
    await expect(assertReadonly(fakeQuery)).resolves.toBeUndefined();
  });

  it('账号意外可写（has_table_privilege 返回 can_write=true）时抛错拒绝启动', async () => {
    const fakeQuery = vi.fn().mockResolvedValue({ rows: [{ can_write: true }] });
    await expect(assertReadonly(fakeQuery)).rejects.toThrow(/账号权限配置错误/);
  });

  it('探测过程中出现意外错误（如网络抖动/语法错误/目标表不存在）时，原样抛出而不是当成自检通过', async () => {
    const fakeQuery = vi.fn().mockRejectedValue(new Error('connection terminated unexpectedly'));
    await expect(assertReadonly(fakeQuery)).rejects.toThrow('connection terminated unexpectedly');
  });

  it('探测查询返回形状不是预期的布尔值时，fail closed 拒绝启动而不是静默放行', async () => {
    const fakeQuery = vi.fn().mockResolvedValue({ rows: [] });
    await expect(assertReadonly(fakeQuery)).rejects.toThrow();
  });
});
