# Task Card: [SelfDrive] Test KR for decomp — 执行验证 & 首个迭代交付

**任务 ID**: ba5dd980-c113-4571-a1b2-147e6ad62c4f
**分支**: cp-04080726-ba5dd980-c113-4571-a1b2-147e6a
**领域**: agent_ops
**优先级**: P1

## 目标

对 decomp（OKR 拆解方法论）的 Test KR 进行执行验证，输出首个迭代交付：
1. 明确验证标准（success 定义）
2. 完成第一个测试周期
3. 输出验证报告，驱动 decomp 方法论迭代

## 验证结论（分析阶段）

Test KR（goals 表，type=area_kr，id=90a9e33e）已于 2026-04-08 归档（archived），current_value=38。
分析发现 decomp-checker v2.0 存在一个 bug：

**Check A 查询了 `ready` 状态的 KR（不应该）**
- 代码：`WHERE g.status IN ('pending', 'ready')`
- 注释说明：「检测 pending 且未拆过的 KR」
- `ready` 状态的 KR 已经完成拆解并由 Vivian 审核通过，不应触发新的拆解任务
- 超过 24h dedup 窗口后，`ready` KR 会被错误地重新触发拆解 → 强制改回 `decomposing`

## 实现范围

1. `packages/brain/src/decomposition-checker.js`
   - Check A 查询改为 `status = 'pending'`（移除 `ready`）
   - 注释更新与代码一致

2. `packages/brain/src/__tests__/decomposition-checker.test.js`
   - 新增测试：`ready` KR 不应触发拆解任务

3. `docs/learnings/cp-04080726-test-kr-decomp-verification.md`
   - 验证报告：Test KR 生命周期 + 方法论发现 + 下次改进建议
