## Brain {VERSION} — 晨报/日报「业务断言红灯」行（链 bf5088a3 棒4 消费）

- 新增 `lib/assertion-red-report.js`：直查 `journey_assertion_receipts` 过去 24h `executor_kind='business_probe_runner'` 且 `verdict='FAIL'` 的回执，经 `journey_step_links → journey_steps / journeys` 取步名/路名，按 路径/步骤/探针 key（`assertion_ref_snapshot` 去 `probe:` 前缀）分组计数；任一 `scenario_evidence.severity=error` → 🔴 RED，只有 warn（或缺失）→ 🟡 AMBER；空集/查询失败/超时 → null（决策 702949b6 / ebcbc038）
- 晨报 `morning-cockpit-bark.js`：`fetchAssertionRedLine` 并列裸跑行，文案「🔴 RED 断言红灯：<路径>/<步骤> <key>×<n>, …（24h）」，最多 3 组步骤；日报 `daily-report-generator.js`：板块九「== 业务断言红灯（24h）==」汇总 + 每组一行带严重级；均 best-effort 不拖垮
- 只依赖回执表形状，不依赖棒3a 合并；smoke `assertion-red-report-smoke.sh` 已登记 allowlist
