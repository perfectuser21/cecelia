## Brain {VERSION} — 判官口粮第二铲：编码线九格 run 证据接线 + 成本缺口与数据缺口分家

- 新增 `packages/brain/src/crystal/coding-grids.js`：编码九格从 home-sequencer `STAGE_ORDER`
  派生（不留硬编码副本），kernel 六相→九格归一（planning→plan / gan→contract / generate /
  evaluate / judge / publish / merge），认不出的相（review 人审、failed/done 终态）返回 null
  不猜；探针认定取 `STAGE_REQUIRED_HANDOFFS`（contract/seal/generate/publish 四格有）。
- 新增 `packages/brain/src/crystal/coding-evidence.js` + CLI
  `packages/brain/scripts/backfill-crystal-coding-evidence.mjs`：`harness_attempts` ∪
  `sequencer_ledger` → `crystal_run_evidence`，一格一日一行，幂等键 (unit_key, verified_at)
  由 (格, 北京日) 唯一确定；`completed_with_concerns` 计次不计通过，cancelled/在途不入账。
  新 scheduler job `crystal-coding-evidence`（10min 自 gate，排在 crystal-judge 之前，
  只补账不代判）。
- 判决单位册页从「漏斗八格」扩到「漏斗八格 + 编码九格」：九格常驻册页而非只靠当日证据触发，
  否则某天没跑整条线就从报告里凭空消失（判决本就按滚动窗口聚合）。
- migration 440 `crystal_ledger.cost_gap`：把「成本证据缺口」从「整源数据缺口」里拆出来。
  编码线有真实跑量但天生无 token 源（task_run_metrics 08-23 断流、kernel attempt 不记 token），
  旧逻辑一律降级 `data_gap` 会把跑过几百次的格子在账上写成 `n_runs=0`——用一种诚实
  （不编成本）换来另一种谎。新增判据 `cost_evidence_missing`（仍 keep_llm，不许晋升）。
- 实测（09-07 本地真库）：2546 条 attempt → 122 行证据（74 条无法归格诚实丢弃），判官
  `coding:contract` n=354/成功率 0.819、`coding:evaluate` n=64/0.828、`coding:generate`
  n=27/0.815 全部基于真数出判；重跑证据行数不变。og1..og8 仍 data_gap：那是 OpenClaw 视觉
  获客八格，逐格证据在 hk-vps n8n 节点级执行记录里，本地无源（留给第三铲）。
