## {VERSION}

### 运行舱驾驶舱化：Notion 双向同步 + 流程活性告警

**背景**：业务流程停跑 20.4 小时无人察觉；Notion 运行舱四库停更两天。

- **推送重新接电**：推送链（`runNotionPushSync`→`pushOpsGraph`→workflows/runs）代码一直完好，但唯一入口 `legacy-notion-push-scheduler` 无人 import 且需 `NOTION_LEGACY_PUSH_ENABLED=true`，等于从不执行。新增 `runOpsNotionPush` 只把 ops 这段接进现代调度层（不启用 legacy 整链，避免连带推 8 条已停用投影）
- **流程活性告警**：`ops-liveness.js` 按各流程近 30 天中位间隔算基线（黄 5 倍 / 红 20 倍），高频流程有绝对下限（黄 5 分钟 / 红 15 分钟）防过敏，低频有 30 天上限防永不报；不足 10 次判 cold 不告警。看板显示 🟢正常/🟡放缓/🔴失联/⚪数据不足 + 「停了 20.4 小时」
- **字段分区双向**：机器列 Brain→Notion 单向覆盖，人工列（归属身份/DisCo 人工档位/优先级关注）Notion→Brain 单向读回，两方向各管各的列不打架；`buildManualUpdateSql` 走列白名单+表白名单
- **停用意图直接生效**（主理人拍板）：Notion 标停用 → 真调 n8n。因不可逆强制幂等（意图与现状一致不动）、留痕（`prev_active`/`enable_intent_at`）、失败可见（`enable_error` 落库，看板显红不静默）、失败不无限重试

迁移 443（活性 6 列 + 人工列 + 增量游标表）。新增 smoke `ops-cockpit-sync-smoke.sh`（已 proven-to-fire）。
