# Learning: PROBE_FAIL_RUMINATION 根因可见化（2026-04-27）

- 影响链路：Brain capability-probe `rumination`
- 严重度：P0（自省/反馈闭环失效，连带触发 brain-rollback 把好版本回滚掉）
- 历史相关：#1586（24h→48h）/ #1832（stage 3 输出事件）/ #2605（心跳事件 + 全失败不标 digested）

---

### 根本原因

`probeRumination` 失败 detail 只暴露 `loop_dead` vs `degraded_llm_failure` 两态，**不带 LLM 失败的真正原因**。生产里 `degraded_llm_failure` 触发时，根因要么是 NotebookLM bridge 超时/认证、要么是 callLLM 余额/ENOENT，运维必须 ssh + grep brain 容器日志 + 翻 `cecelia_events` 才能定位 → MTTR 拉长。

更糟的是 `dispatchAutoFixes` 把 `f.detail` 当作 RCA 上下文喂给 dev skill。detail 里没根因 → 自动修复任务在错方向反复打转 → 触发批次/连续失败回滚阈值 → 把好版本回滚掉，问题反而恶化。

`last_run` 字段被 48h 窗口约束 — 卡顿超过 48h 时显示 `never`，丢失"上次成功是何时"这一关键诊断信息。

---

### 修复

- `rumination.js`：`digestLearnings` 双路（NotebookLM + callLLM fallback）各自捕获失败原因；双路都失败时写结构化事件 `cecelia_events.rumination_llm_failure`（payload 含 `notebook_error` / `llm_error` / `batch_size` / `learning_ids`）
- `capability-probe.js`：拆 `last_run` 查询为全局 `max(created_at)`（不带 INTERVAL 过滤）；`degraded_llm_failure` 时查最近一次 `rumination_llm_failure` 事件并把 `notebook=...` `llm=...` 摘要拼到 detail 末尾
- 单测：3 条 grep 断言 — 全局 last_run 查询 / event_type 查询 / detail 透出格式

---

### 下次预防

- [ ] 任何外部依赖（LLM、CLI bridge）失败的探针，detail 必须含**最近一次具体错误**，不只给"通用失败"标签 — 否则 dispatchAutoFixes 会空转 + 把好版本回滚掉
- [ ] 探针的 "last X happened at" 字段不要用业务窗口（48h）约束 — 全局 max 才是诊断信息；空表显示 never，否则给真实时间
- [ ] 任何"双路 fallback"的 LLM 调用都应在双路全失败时写 forensic 事件 + payload 带两路各自错因 — 这是 SRE 自检的第一手证据
- [ ] 写完 RCA 修复别留在工作区 — 立刻按 cp-* 分支 + PR 走，不在 main 工作区放未提交的 P0 修复
