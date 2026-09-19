## Brain {VERSION} — 模型账号配额+机器可达性投影（工厂·F5 指挥舱 刀2）

- 新增 GET /api/brain/agent-ops/model-accounts：8 个静态模型账号（Claude Code x2 + Codex team x5 + Grok）配额快照只读投影，每条 11 字段（provider/plan/five_hour_pct/seven_day_pct/reset_at/host_alias/forwardable/forward_targets/status/last_checked_at/last_error）；单账号失败只标该条（unknown/key_expired/no_credential + last_error）不阻塞整体，HTTP 200。
- agents 端点每条追加 model_role{model_id, primary_count, fallback_count}（全体分身真实聚合，不造分层标签）。
- 新表 ops_model_accounts（migration 449）+ ops-model-accounts-collector（三家 usage parser 归一 schema + 幂等 ON CONFLICT upsert + Grok key 过期只标 key_expired、任何路径绝不刷 refresh_token）。
- Notion「Agents&机器」库 schema 加配额列 FiveHourPct/SevenDayPct/QuotaUpdatedAt。
