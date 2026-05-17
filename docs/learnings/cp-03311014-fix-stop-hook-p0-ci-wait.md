# Learning: fix-stop-hook-p0-ci-wait

## 背景

stop.sh 有 p0/p1 两段阶段逻辑，p0 在 PR 创建后立即 exit 0，导致 CI 从未被检查，I3/I4 等任务创建 PR 后直接退出，没有自动修复循环。

## 根本原因

p0 阶段的设计初衷是"PR 刚推出去，这次 session 就结束"，但实现为 exit 0（允许退出）而非 exit 2（阻止退出继续等）。这导致创建 PR 就被当作任务完成，CI 是否通过从未被检查。
真正的完成条件只有一个：CI 全绿（或 PR 已合并）。任何在 CI 检查之前的 exit 0 都是提前放行，破坏了 stop hook 的循环保证机制。
此外 metrics.test.ts 有月末溢出 bug：`setMonth(getMonth() - 1)` 不先 `setDate(1)`，导致 3 月 31 日的"上月"计算结果为 3 月 3 日（2 月 31 日 = 3 月 3 日），时间窗口测试在月末会误判。

## 下次预防

Stop Hook 新增或修改退出逻辑时，必须验证：exit 0 只在 CI 全绿之后触发，不允许在 PR 创建阶段 exit 0。日期计算涉及"减月"时，必须先 setDate(1) 再 setMonth(-N) 避免月末溢出。

## Checklist

- [x] p0 阶段的 exit 0 代码块已删除
- [x] PR 创建后统一进入 CI 状态检查（p0/p1 合并）
- [x] metrics.test.ts 月末溢出修复（setDate(1) before setMonth(-1)）
- [x] detect-review-issues.js 支持 `🔴 **严重问题**` bold 标题格式
