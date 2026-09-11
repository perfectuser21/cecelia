// F1「工厂 · 开发闭环」步骤 3「造完真验」—— 边：worktree 建立 ↔ base repo 来源
//
// 2026-09-11 生产实证（us-vps）：golden_path_proposal 任务 loadSkillBundle 成功后，
// 下一步建 worktree 时报 "fatal: repository '/Users/administrator/perfect21/cecelia'
// does not exist"——DEFAULT_BASE_REPO 一直硬编码 macOS 的"活人主仓"路径，跟
// REPO_ROOT/skill 加载是同一类坑（Linux 上这个路径根本不存在）。
//
// 修复：Linux 平台下 DEFAULT_BASE_REPO 跟着 REPO_ROOT 走（us-vps 上没有交互式开发，
// 只有一份 checkout）；macOS 保持原硬编码路径不变（mmv 上 REPO_ROOT 指向的是另一个
// "CD专用部署根"，跟活人主仓历来是两份不同 checkout，不能直接复用）。
//
// 按产物闸规矩写在边上：真 import harness-worktree.js（不 mock 被改模块）。
// CI runner 全 ubuntu-latest（process.platform === 'linux'），本测试断言的正是
// 这条真正在生产上出过事的分支。
import { describe, expect, it } from 'vitest';
import { DEFAULT_BASE_REPO } from '../../../packages/brain/src/harness-worktree.js';

describe('harness-worktree DEFAULT_BASE_REPO 按平台区分（r us-vps worktree 案卷）', () => {
  it('Linux 平台下 DEFAULT_BASE_REPO 跟着 REPO_ROOT 走，不是硬编码的 macOS 活人主仓路径', () => {
    if (process.platform === 'linux') {
      expect(DEFAULT_BASE_REPO).toBe(process.env.REPO_ROOT || '/root/cecelia');
      expect(DEFAULT_BASE_REPO).not.toBe('/Users/administrator/perfect21/cecelia');
    } else {
      // 非 Linux（本地 macOS 开发机跑测试时）：保持既有硬编码路径不变，零回归。
      expect(DEFAULT_BASE_REPO).toBe('/Users/administrator/perfect21/cecelia');
    }
  });
});
