# Handoff：管家棒 07-15 上午——Gate3 三部曲收官 + preview 泄漏根治 + 两起宿主事故处置

- 会话：2026-07-15 管家 session 5d697188（上午）｜ verdict: PASS
- task_id: unknown（管家会话，镜像单写；分项任务各有独立 handoff 见下）
- 上一棒：docs/handoffs/202607150655-ops-half-loop-blade4-complete.md

## ✅ 完成

1. **Gate3 自动部署三部曲全收官**（上一棒最优先 P1「假跳过」，根因经实证纠偏）：
   - #3942 可达性：webhook 链路 brain-deploy.sh 在容器内跑，smoke 探 localhost:5223 秒拒（green 端口发布在宿主+默认 bridge 跨网隔离）→ green 加入 blue 网络 + GREEN_URL 双模式。原立案"changed 为空"未被证据支持，但 fallback 死代码（管道退出码取 tr）确实存在，抽 gate3-changed-paths.sh 一并修了
   - #3946 smoke 去 jq：blue 容器无 jq（07-14 两个 jq 修复在 rebase 混乱中丢失），4 核心 smoke 改 node 断言 + 禁 jq CI 守卫。**合并即实弹验火 PASS：Gate3 全自动上线 1.263.3，smoke 5/5，零人工**
   - #3950 假红：等待步 300s < 部署 ~7min，assert 一锤判定（900 是 uptime 阈值非等待预算）→ assert-deploy-effect 加 wait_budget_s 重试（workflow 传 600s，job 超时 20min）。验火=下次 brain 合并 Gate3 应转绿
2. **preview 泄漏根治①收口**：reaper 三源对账器上线（#3960，Brain 抢跑会话产出；本会话重复 PR#3957 按撞车规矩关闭）；宿主收尾=deploy-main 悬空 worktree 注册清理（preview 环境起不来的根因）+ 实弹回收归零（12 个 preview DB 全对应 open PR）+ cron 每小时 :20 挂 **cecelia-deploy-main**（主仓 checkout 被会话争用不可依赖，已踩过一次）
3. **事故处置 ×2**：
   - 宿主盘 100% 满（695Mi 剩）→ OrbStack VM StorageFull 自杀 → 生产全灭。清 preview 残留 ~10G + 旧 brain 镜像 10 个 + builder cache 2.7G → 现 46Gi(76%)。Notion P1 issue 已立案（三件套根治）
   - 熔断 cecelia-run 又 OPEN（research 任务 bd8f063b 派发失败烧 16 次）→ 隔离 + 复位
4. Ops 半环 PRD 状态行刷新（#3964）：刀 0-4 全 ✅，仅剩刀 5
5. 分项 handoff：202607150838-1c47748a / 202607150838-3ae60c87 / 202607150934-8907aef8（均双写）

## ❌ 未完成 / 遗留（优先级序）

1. **刀 5「AI-Native 闭环」PRD 未写**——Ops 半环唯一剩余项。⚠️ 主理人已拍板：**直接写 PRD，不走 /architect 拆解**
2. **OrbStack VM 盘受损隐患**：一天死三次，第三次宿主有 45G 空闲仍 I/O error 自杀（盘满期 btrfs 吃了写错误）。postgres 在宿主数据无险、容器全无状态。复发则根治=计划停机 `orbctl reset docker` + brain-deploy 重建，**需主理人拍板**
3. 盘满根治剩两件（Notion P1 issue）：brain-deploy 旧镜像保留策略（N-2 之前的 tag 清理）、janitor 70% 告警链路为何没兜住
4. 抢跑病新实证：Brain 重启把 claimed_by 连同 status 一起洗掉 → tick 抢跑重复实现。根治方向=claim 持久化过重启 或 tick 派发前 GitHub 撞车检查
5. 老病：codex research 派发失败反复烧熔断；飞书 notifier 缺 im:message:send scope 报错刷屏；#3950 假红修复待下次 brain 合并验火

## 数据源

- Memory：gate3-autodeploy-restored.md（三部曲+事故+新规矩全录）
- PRD：docs/prd/2026-07-14-ops-half-loop.prd.md（状态行已刷新）
- 生产：cecelia-node-brain 1.263.3 healthy；reaper cron 日志 /tmp/preview-reaper-cron.log
- 新规矩（有 CI 守卫）：容器内探活禁裸写 localhost:宿主端口（照抄 GREEN_URL 模式）/ smoke-core 禁 jq / 断言必须自带等待预算 / 守卫必须同 PR 接线 ci.yml / 事件式清理必配周期对账兜底

## 产物指针

- PR：#3942 / #3946 / #3950 / #3960(抢跑产物已复用) / #3964 + handoff PR #3948/#3951
- 已关：#3957(与#3960撞车) / #3947(分支命名)
