# PRD: /dev SKILL TDD enforcement + 测试策略 gate

## 背景

近期 brain-v2 系列开发暴露问题：
1. subagent-driven-development 派 subagent 时若 prompt 没显式要求 TDD，subagent 经常先写实现再补测试，违反 Superpowers TDD iron law。
2. brainstorming spec 若不强制「测试策略」段，design 通过后到 plan 阶段才发现测试盲区，回炉成本高。

## 目标

`packages/engine/skills/dev/SKILL.md` 加 2 处 Tier 1 默认表补丁，让 /dev 接力链 autonomous 流程不再漏 TDD：

### 补丁 1：subagent prompt 必须 inline TDD iron law
- "NO PRODUCTION CODE WITHOUT FAILING TEST FIRST"
- "Throwaway prototype 才 skip — 你不是写 prototype"
- "每 plan task 必须 git commit 顺序：commit-1 fail test / commit-2 impl"
- "controller (team-lead) 会 verify commit 顺序，不符合让你重做"

### 补丁 2：brainstorming spec 必须含「测试策略」段
- 跨进程/重启/持久化/I/O 行为 → E2E test
- 跨多模块行为 → integration test
- 单函数行为 → unit test
- Trivial wrapper（< 20 行无 I/O）→ 1 unit test 即可
- spec 缺测试策略段 → Research Subagent reject design approval

## Scope
- 改：`packages/engine/skills/dev/SKILL.md`
- 改：`packages/engine/skills/dev/steps/autonomous-research-proxy.md`
- 不动：`packages/engine/skills/dev/scripts/*` / superpowers/*

## 成功标准

- [BEHAVIOR] SKILL.md 含 "NO PRODUCTION CODE WITHOUT FAILING TEST" 字符串
- [BEHAVIOR] SKILL.md 含 "测试策略" 字符串
- [BEHAVIOR] autonomous-research-proxy.md Tier 1 表加 TDD 强化条目
- [BEHAVIOR] git diff 仅改这 2 个文件
- [ARTIFACT] 改后的 SKILL.md 行数 60-100
