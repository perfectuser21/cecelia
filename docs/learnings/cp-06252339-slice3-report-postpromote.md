# Learning — Slice 3：report 后移到 production promote 完成后

> 分支：cp-0625232915-slice3-report-postpromote
> 日期：2026-06-25

## 背景

阶段2 最后一片。report 从"合 main 后"摘出，改为 production promote 完成后触发，
内容补全 staging E2E 结果 + 放行人/时间 + production 版本 + 回档锚点。

## 做了什么

- `staging-promote.js`：加 `buildHarnessReportInsert`（幂等 by initiative_id）/ `spawnHarnessReport`（best-effort）/ `readProductionInfo`（读 .brain-versions/.production-release）/ `REPORT_KIND` 三态。
- reportNode（harness-initiative.graph.js）：**只在 verdict≠PASS 派失败报告**，PASS 不派；**保留生命周期闭合**（initiative_runs phase / tasks.status / 容器清理）在 merge 时。
- staging-e2e-runner（内部线 auto_promoted）+ routes/harness.js（客户线 confirm promoted）各派**成功交付证书**。
- migration 307：staging_e2e_results 加 promoted_by。
- harness-report.mjs：补"上线/Production"段（report_kind/staging E2E/放行人/时间/版本/回档锚点）。

### 根本原因

这片最容易犯的错是**把整个 reportNode 挪走**。深挖发现 reportNode 干 4 件事：
1) UPDATE initiative_runs phase=done  2) UPDATE tasks.status + report_content  3) 派 harness_report  4) 容器清理。
**只有第 3 件（report 产物）该挪**；1/2/4 是合法的"merged-done"生命周期闭合——挪走会让 task 永卡
in_progress（W28 修补点明文警告）+ 容器泄漏。即：**initiative 生命周期"代码进 main"= done 不变；
report 产物"已上 production"才出**——两个语义解耦，分别由不同信号驱动。

第二个张力是**报告饿死**：promote 完成时机分叉极大（内部线秒级 / 客户线挂数天）。若只"promote 完成才出
report"，FAIL 和长期 pending 的 initiative 永不出 report = 失败静默消失。决策 B 解：
- promote 完成 → 成功证书；FAIL/SKIP/promote_failed → reportNode 终态出失败报告；
- pending_promote 不出（但 Slice2 已给了通知+状态可见，是"可见地等放行"，不是"消失"）。

### 下次预防

- **挪一个节点前先拆它干了几件事**：生命周期闭合（状态机终态/资源清理）vs 业务产物，往往该分开处理，
  别整体挪——会破坏其他依赖该节点副作用的不变量。
- **"完成"是多语义的**：merged-done ≠ in-production。用不同 DB 信号建模不同语义阶段，别用一个 phase 混表达。
- **异步分叉的收尾动作要防饿死**：每条终态路径（成功/失败/长期挂起）都要明确"出不出收尾物 + 靠什么可见"，
  pending 必须有独立可见性（通知+状态），否则就是静默黑洞。
- 复用现有件：production 版本/回档锚点从 .brain-versions/.production-release 取，不新建账本。

## checklist

- [x] reportNode 只挪 harness_report 派发，保留生命周期闭合（phase/task status/容器清理）
- [x] PASS reportNode 不派；FAIL reportNode 派失败报告（不饿死）
- [x] 内部线 auto_promoted + 客户线 confirm promoted 各派成功证书
- [x] harness_report 按 initiative_id NOT EXISTS 幂等（真 DB 验：重复 INSERT 被挡）
- [x] report 内容补全 report_kind/staging_e2e_verdict/promote_status/promoted_at/promoted_by/production_version/rollback_anchor
- [x] migration 307 promoted_by（ALTER，不动已合 304/305/306）
- [x] pending_promote 不饿死（靠 Slice2 通知+状态可见）
- [x] 不碰 interrupt；DevGate 三件套全过
