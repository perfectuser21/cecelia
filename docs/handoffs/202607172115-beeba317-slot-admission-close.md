# Handoff：产能判定合并收官（beeba317）— PASS

- 日期：2026-07-17 21:15 CST ｜ 会话 45f2cb5d（有头 /dev 全程）
- verdict：**PASS**（PR #4055 merged + 生产 1.267.0 实弹验证）
- 上游设计：docs/handoffs/202607171730-slot-allocator-consolidation.md（v2）；决策 4c7e935c

## 完成

1. **harness 派发闸换轨**：任务数常数 `MAX_CONCURRENT_HARNESS_INITIATIVES=2`（已删）→ `slot-allocator.harnessSlotCheck()`：拟占用（活 relay 容器 + 5min 宽限 inflight）< 动态 cap = min(VM内存余量÷1024档, 可用Claude账号数×2, HARD_CAP=8)。判定唯一入口收归 slot-allocator，dispatcher 仅留 `HARNESS_TASK_CAP_BACKSTOP=12` 纯兜底。
2. **machine-vitals 采样器**（新模块）：docker 容器数/VM 内存/盘水位 60s 采样写缓存（scheduler-jobs 首位），派发热路径零命令执行；stale>15min（含 never-good 冷启动）写 `machine_vitals_stale_alert` 哨兵 + 告警，恢复清键。
3. **额度收编**：Claude 侧复用 `checkQuotaGuard()`（>98% 拒 / >90% 仅 P0P1），禁第五套；codex 闸/tokenExhausted 不动。resume 豁免语义不变；探针放行逃生阀（零容器+零余量放行 1 条防饿死）有显式注释+测试。
4. **capacity-budget API 加 machine_vitals 段**（指挥舱 80a5be84 可直接吃）。
5. brain 1.267.0；新增测试 34 条；全仓 19 个 slot-allocator mock 补 harnessSlotCheck 桩；顺手灭掉 scheduler-jobs 单测 ssh 逃逸真机收割 worktree 的隐患（mock disk-guard）。
6. **生产实弹验证**（21:12）：`slot_check containers=3 inflight=0 cap=4(mem=8 acct=4 hard=8) stale=false verdict=allow`——3 活容器照常放行（旧闸 cap=2 此刻必卡死）；冷启动 `deny:vitals_stale` 实弹验证保守拒发路径；machine_vitals 段 live（VM 9995MB/用1088MB/盘35%）。

## 没完成

- 刀2 三轴选择系（多账号 Claude/Codex/Grok × 多机）→ 已另立 architecture_design 任务 `600295fe`
- proven-to-fire 破坏性一环（弄坏 prod docker socket 看 deny+哨兵）——危险操作需拍板；冷启动 stale 拒发已在生产实弹覆盖同路径
- 留案 Minor：quota-guard mock 字段名 nit（dispatcher-harness-concurrency-cap.test）、`_spendingCapMap` 缺对称 reset、headed 任务 inflight 口径失真、`HARNESS_HARD_CAP` 未透传 docker-compose、spec-advancement-model.md 旧常量引用

## 过程新立案（本战附产物）

- **Gate3 假跳过复发第3型**（Notion P1 `54a7ddc7`）：① webhook 撞 409 被 workflow 当"变更已含"吞掉（那轮 deploy checkout 早于本 merge）；② deploy-local.sh SHA 对账先于 fetch → 陈旧 SHA 判无改动 2.7s 假 success。本次两次人工补触发才上线。根治方向写在 issue 里。

## 下一步

- 指挥舱首页吃 machine_vitals 段做可视化（80a5be84）
- 刀2 设计任务 600295fe 排队中（P2，依赖本战接口：harnessSlotCheck(machine) 分桶签名 + 账号数派生天花板）

## 数据源

- `packages/brain/src/slot-allocator.js`（harnessSlotCheck）/ `machine-vitals.js` / `dispatcher.js`
- spec：docs/superpowers/specs/2026-07-17-slot-allocator-consolidation-design.md
- tasks.result.handoff（SSOT，task beeba317）
