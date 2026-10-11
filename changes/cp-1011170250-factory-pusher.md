## Brain {VERSION} — 技能工厂推进器 + 自动裁判：业务 workflow 在工厂里按规则自动推进

- 推进器（任务 a5f42455）：tick 每 5 分钟逐行看 `factory_ledger`——1/2/3 跑验类无在途、不卡、发布时段（上海 09–23）内建 `payload.factory_dispatch=true` 执行单交派发器（1=skill-explore / 2=skill-boundary / 3=候选版本正常跑）；滑窗满且全过 rule 推进；滑窗出现 fail 清零重来（新增 `resetLedgerWindow`，落 from=to 阶段事件留痕）；stage 3 连续失败（safe_stop 不计）达阈值（默认 3）退回 2；4 沉淀 / 6 蒸馏建 /dev 工单（只建单）完成后推进；5 上线跑建 Commander 工单，对外首次上生产标 human_gate；7 守护尾部连续 fail 达阈值退回 6 并告警；人工关口 / 安全红线不动；同行最多 1 张在途；配置取不到标 `blocked_kind=resource` 写原因不猜；决策写 `next_action` / `factory_stage_events`
- 自动裁判（任务 2231ecc0）：执行单终态带 `result.delivery` 时代码裁判 → pass 且需看图自动建 run-verify 核验单 → 合并两者都 pass 才 pass → `recordRun` 入窗（同 run_id 去重，`safe_stop` / `source_task_id` 写进滑窗）；结论写回执行单 `result.factory_judge`
- 配置 `config/factory-workflows.json`（设备 / agent / 技能 / 正文纪律 / 验收 / 阈值 / 发布时段），首条：抖音·视频发布（安卓真机）
- 开关：`FACTORY_PUSHER_ENABLED=false` 或 `brain_config` `factory_pusher_enabled=false`（默认开）；间隔 `FACTORY_PUSHER_INTERVAL_MS`
- smoke `factory-pusher-smoke` 登记 write-targets + allowlist；决策 cc008b7e / 2bb08a99 / 7c6f7ae2 / 2aceef75
