/**
 * ssh-args.test.js
 *
 * 终审 I6：SSH_BASE_ARGS 原定义在 notion-push-sync.js（重依赖链模块），
 * 抽到中立叶子模块 lib/ssh-args.js，供 notion-push-sync.js 与
 * executor-contracts.js 共同 import，值必须原样不变（见基线 commit
 * 5c232c9da 的 notion-push-sync.js:447-450）。本文件真 import 被抽出的
 * 模块，断言数组内容与冻结状态，以及 CI 全库真正依赖的两个关键安全 flag
 * （BatchMode=yes 防交互挂起、ControlPath=none 防复用坏掉的 ControlMaster
 * 连接）确实存在。
 */
import { describe, it, expect } from 'vitest';
import { SSH_BASE_ARGS } from '../ssh-args.js';

// 基线字面量 fixture：从 notion-push-sync.js 原地抽出前的定义（commit
// 5c232c9da），逐项原样保留，抽模块不改值。
const BASELINE_SSH_BASE_ARGS = [
  '-o', 'ControlMaster=no', '-o', 'ControlPath=none', '-o', 'BatchMode=yes',
  '-o', 'ConnectTimeout=10', '-o', 'StrictHostKeyChecking=no',
];

describe('ssh-args: SSH_BASE_ARGS 抽模块零行为变化', () => {
  it('数组内容与抽出前的基线字面量逐一相等（含顺序、含长度）', () => {
    expect(SSH_BASE_ARGS.length).toBe(BASELINE_SSH_BASE_ARGS.length);
    expect(SSH_BASE_ARGS).toEqual(BASELINE_SSH_BASE_ARGS);
  });

  it('是冻结数组，运行期不可被 push/pop/元素赋值篡改', () => {
    expect(Object.isFrozen(SSH_BASE_ARGS)).toBe(true);
    expect(() => { SSH_BASE_ARGS.push('-o'); }).toThrow();
    expect(() => { SSH_BASE_ARGS[0] = 'tampered'; }).toThrow();
  });

  it('含 BatchMode=yes（禁交互提示，ssh 卡死变成立即失败而非挂起）', () => {
    const idx = SSH_BASE_ARGS.indexOf('BatchMode=yes');
    expect(idx).toBeGreaterThan(0);
    expect(SSH_BASE_ARGS[idx - 1]).toBe('-o');
  });

  it('含 ControlPath=none（禁用连接复用，防止复用一条已坏的 ControlMaster 连接）', () => {
    const idx = SSH_BASE_ARGS.indexOf('ControlPath=none');
    expect(idx).toBeGreaterThan(0);
    expect(SSH_BASE_ARGS[idx - 1]).toBe('-o');
  });

  it('含 ConnectTimeout=10 与 StrictHostKeyChecking=no（探活/直派超时与非交互 host key 确认）', () => {
    expect(SSH_BASE_ARGS).toContain('ConnectTimeout=10');
    expect(SSH_BASE_ARGS).toContain('StrictHostKeyChecking=no');
  });

  it('可直接展开拼进 execFileSync 的 args 数组（typeof 全部为 string，无 undefined/null 空洞）', () => {
    for (const v of SSH_BASE_ARGS) {
      expect(typeof v).toBe('string');
      expect(v.length).toBeGreaterThan(0);
    }
  });
});
