# 小改动 PrepPRD:execution-callback 韧性——回调重试 + 迟到回调幂等 + 补齐写库协议

## 改什么
1. **Brain 侧** `packages/brain/src/routes/execution.js:172-190`(execution-callback 主写):
   - UPDATE 补 `updated_at = NOW()`(当前不刷,导致任务完成瞬间 updated_at 停在旧值,被 zombie-reaper/dead-reset 误判)
   - terminal 态(completed/failed)时补清 `claimed_by = NULL, claimed_at = NULL`(与 routes/tasks.js:429-432 PATCH 协议对齐)
   - **迟到回调幂等**:任务已处于 terminal 态时,回调返回 200 + `{already_terminal:true}`,不报错不覆盖
2. **执行者侧** 回调发送处(cecelia-run/callback 写回脚本):HTTP 回调失败时指数退避重试 ≥5 次,总窗口覆盖 ≥60s(蓝绿切换 ~10s API 不可用窗口 + 余量)

## 为什么改
brain-deploy 蓝绿切换期间回调丢失 → 任务永卡 in_progress → 被 zombie-reaper 误标 failed。这是"一更新 brain 其他全死"体感的直接来源之一(2026-07-10 架构审查结论,memory: brain-harness-split-brain-audit)。

## 关联上下文
- 相关审查:brain-harness-split-brain-audit(07-10);Notion Issue 4e744514(reaper 误杀)
- 相关历史决策:decisions/match 无冲突记录

## 影响范围
- execution-callback 是所有 cecelia run 完成回写的主通道,改动必须保持 `WHERE status IN ('in_progress','queued','dispatched')` 守卫语义
- 迟到回调幂等改变返回码语义(原来可能 4xx),调用方只认 2xx 成功,无破坏
- 执行者重试不改变 payload,天然幂等安全

## 验收标准
- [ ] failing test 先行:vitest 断言 execution-callback 写入后 updated_at 刷新、terminal 清 claim、迟到回调返回 200 幂等
- [ ] 执行者回调重试逻辑有单测或 smoke(模拟 5221 前 N 次拒连后恢复)
- [ ] CI 全绿
