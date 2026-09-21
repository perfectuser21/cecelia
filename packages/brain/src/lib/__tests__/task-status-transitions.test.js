/**
 * 任务状态机的机械守卫。
 *
 * 0921 事故：`PATCH /tasks/:id` 的转移表只枚举了 pending/queued/in_progress/
 * completed/failed/quarantined/paused/canceled 八个状态。任何没枚举到的状态取到
 * `undefined`，被 `allowedTransitions[current]?.includes(...)` 判否，再以
 * `allowed: []` 返回——**和「这是设计上的终态」长得一模一样**。
 *
 * 生产实测在押（2026-09-21）：blocked 287 / cancelled（双 L）1485 / archived 673 /
 * completed_no_pr 38 / quota_exhausted，共 2483 条活干完了也写不回账本。
 * 本 session 自己撞了一次：任务 a70d7743 因 map_stale 被判 blocked，PR #5457 已合并，
 * 回写 completed 被 409 `allowed: []` 挡死（issue a4991491 第五次发作）。
 *
 * blockTask 的文档写着 `until: null = 手工解除`——而「手工」这条路正是被上面这个洞
 * 堵死的，所以 287 条 blocked 全部 blocked_until IS NULL，自愈回路
 * （tick-helpers `WHERE blocked_until <= NOW()`）一条也匹配不到。
 *
 * 守卫两条：
 *  ① 代码里任何写进 tasks.status 的字面量，都必须在转移表里有**显式**表项
 *     （哪怕是空数组，也必须是写出来的 intentional 终态，不能靠"查不到"默认成终态）
 *  ② 等待态（blocked / quota_exhausted / paused / quarantined / 两种拼写的 cancel）
 *     必须有出边——它们是"等一等"，不是"结局"
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import {
  TASK_STATUSES,
  TRANSITIONS,
  TERMINAL_STATUSES,
  resolveAllowedTransitions,
} from '../task-status-transitions.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const BRAIN_SRC = resolve(HERE, '../..');

/** 递归收集 brain src 下的 .js（跳过测试与 node_modules）。 */
function collectSources(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '__tests__' || name === 'coverage') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) collectSources(full, out);
    else if (name.endsWith('.js') && !name.includes('.test.')) out.push(full);
  }
  return out;
}

/** 从 `UPDATE tasks ... SET ... status = 'X'` 里机械抽出写入的状态字面量。 */
function scanWrittenStatuses() {
  const found = new Map(); // status -> Set(file)
  for (const file of collectSources(BRAIN_SRC)) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/UPDATE\s+tasks\b[\s\S]{0,500}?\bstatus\s*=\s*'([a-z_]+)'/gi)) {
      const status = m[1];
      if (!found.has(status)) found.set(status, new Set());
      found.get(status).add(file.slice(BRAIN_SRC.length + 1));
    }
  }
  return found;
}

describe('任务状态机不得有隐式死胡同', () => {
  it('转移表为每个已知状态写出显式表项（终态也要显式写成 []）', () => {
    const missing = TASK_STATUSES.filter((s) => !Object.hasOwn(TRANSITIONS, s));
    expect(missing, `这些状态在 TASK_STATUSES 里却没有转移表项：${missing.join(', ')}`).toEqual([]);
    const extra = Object.keys(TRANSITIONS).filter((s) => !TASK_STATUSES.includes(s));
    expect(extra, `转移表里有 TASK_STATUSES 未声明的状态：${extra.join(', ')}`).toEqual([]);
  });

  it('代码里写进 tasks.status 的每个字面量都必须是已知状态', () => {
    const written = scanWrittenStatuses();
    // 防正则失效导致空集假绿：生产里至少有 blocked/queued/failed 这几种写法。
    expect(written.size, '扫不到任何 UPDATE tasks SET status — 正则失效了，本条断言已失去意义')
      .toBeGreaterThan(3);
    const unknown = [...written.keys()].filter((s) => !TASK_STATUSES.includes(s));
    expect(
      unknown,
      unknown.map((s) => `${s}（写于 ${[...written.get(s)].join(' / ')}）`).join('；')
        + ' —— 这些状态代码会写进库，但转移表不认识，落进去就是 allowed:[] 永久卡死',
    ).toEqual([]);
  });

  it('等待态必须有出边——它们是"等一等"，不是"结局"', () => {
    const waiting = ['blocked', 'quota_exhausted', 'paused', 'quarantined', 'canceled', 'cancelled'];
    for (const s of waiting) {
      expect(TASK_STATUSES, `${s} 应当是已知状态`).toContain(s);
      expect(
        TRANSITIONS[s]?.length ?? 0,
        `${s} 是等待态却没有任何出边：活干完了也写不回账本（a4991491 的正主）`,
      ).toBeGreaterThan(0);
      expect(TERMINAL_STATUSES, `${s} 不该被列为终态`).not.toContain(s);
    }
  });

  it('等待态必须能直接回到 completed —— PR 合了要能销账', () => {
    for (const s of ['blocked', 'quota_exhausted', 'paused', 'quarantined', 'canceled', 'cancelled']) {
      expect(TRANSITIONS[s], `${s} 无法直接回写 completed`).toContain('completed');
    }
  });

  it('未知状态必须可分辨，不能伪装成终态', () => {
    const known = resolveAllowedTransitions('blocked');
    expect(known.known).toBe(true);

    const unknown = resolveAllowedTransitions('some_status_nobody_declared');
    expect(unknown.known, '未声明的状态必须报 known=false，否则又会被当成终态').toBe(false);
    expect(unknown.allowed).toEqual([]);
  });

  it('设计上的终态确实没有出边（防止把守卫改成恒真）', () => {
    expect(TERMINAL_STATUSES.length).toBeGreaterThan(0);
    for (const s of TERMINAL_STATUSES) {
      expect(TASK_STATUSES).toContain(s);
      expect(TRANSITIONS[s], `${s} 声明为终态却有出边`).toEqual([]);
    }
  });
});
