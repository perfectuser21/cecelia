# Learning: cp-0426171419-cleanup-a-tdd-skill

## 上下文

team `brain-v2-tdd-cleanup` task #1：/dev SKILL 加 TDD enforcement + 测试策略 gate。
brain-v2 系列 PR 集中暴露：autonomous /dev 接力链里 subagent 经常先写 impl 再补测试，违反 Superpowers TDD iron law；spec 阶段不强制「测试策略」段，到 plan / impl 才发现测试盲区，回炉成本高。

## 根本原因

1. **subagent prompt 缺 inline TDD red line**：orchestrator 派 implementer 时，prompt 只说"按 plan 实现"，subagent 默认走最少阻力路径——直接 impl，"等 CI 报红再补 test"。Superpowers TDD iron law 在 `superpowers:test-driven-development` skill 里，但 subagent 不会主动 Read 这个 skill。
2. **brainstorming spec 没有「测试策略」硬 gate**：design APPROVE 流程只看产品需求 + 架构合理性，不审"这功能怎么测"。导致跨进程/I/O 行为常常只配 unit test，E2E 缺位。

## 下次预防

- [ ] 所有 /dev 派 subagent 的 orchestrator prompt 必须 inline 4 条 TDD 红线（见 SKILL.md Tier 1 默认表第 26-30 行）
- [ ] brainstorming spec 在 design APPROVE gate 必须 grep `测试策略` 段；缺则 reject、回去补
- [ ] 测试分级用 4 档锚定金字塔（E2E / integration / unit / trivial）—— 跨进程/重启/持久化/I/O → E2E；跨多模块 → integration；单函数 → unit；< 20 行无 I/O wrapper → 1 unit test 即可
- [ ] controller (team-lead) 在 PR 合并前 `git log --oneline` 验证 commit 顺序：commit-1 fail test → commit-2 impl；不符合让 subagent 重做
- [ ] 本 PR 自身严格走 TDD：先写 5 个 fail test（grep SKILL.md / 行数 / 文件白名单）→ 验证 RED → 改文件 → 验证 GREEN → commit

## 测试覆盖

5 个 DoD manual:node 命令全 GREEN：
1. SKILL.md 含 "NO PRODUCTION CODE WITHOUT FAILING TEST" ✓
2. SKILL.md 含 "测试策略" ✓
3. autonomous-research-proxy.md 含 "TDD iron law" + "测试策略" ✓
4. git diff 仅改 2 个 skill 文件（+ PRD/DoD/Learning） ✓
5. SKILL.md 行数 60-100（最终 63 行） ✓
