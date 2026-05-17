# RCA — PROBE_FAIL_RUMINATION 100% 失败率

- 事件日期：2026-04-27
- 影响链路：Brain capability-probe `rumination`
- 严重度：P0（自省与反馈闭环失效，连带影响 auto-fix 准确性）
- 状态：诊断修复已落盘（待提交分支并部署）

---

## 1. 表象

`/api/brain/capability-probe` 中 `rumination` 探针每个周期返回 `ok=false`，连续失败 ≥3 次会触发 `brain-rollback.sh`。
失败 detail 形如：
```
48h_count=0 last_run=never undigested=N recent_outputs=0 heartbeats_24h=? (loop_dead|degraded_llm_failure)
```

历史相关修复：
- #1586 改 24h → 48h 时间窗
- #1832 增加 stage 3 `rumination_output` 事件检查
- #2605 增加心跳事件（`rumination_run`）+ LLM 全失败时不标 `digested=true`

---

## 2. 根因

`probeRumination` 失败路径只暴露了"是否 loop_dead vs degraded_llm_failure"两态，但未暴露 LLM 失败的真正原因。在生产中 `degraded_llm_failure` 多次触发：
- NotebookLM CLI（`bridge /notebook/query`）超时/认证失效
- callLLM fallback（Anthropic Bridge）账号余额或 ENOENT 错误（参考 #2484、#5a6fba679）

由于 probe detail 中没有任何 LLM 错误信息，运维不得不每次都登录 Mac mini → grep brain 日志 → 翻 `cecelia_events` 才能定位。这导致：
1. MTTD（平均检测时间）短、MTTR（平均恢复时间）长
2. `dispatchAutoFixes` 用 `f.detail` 喂给 dev skill，但 detail 里没根因 → 自动修复任务在错误的方向上反复打转
3. 触发批次/连续失败回滚阈值后，反而把好版本回滚掉，问题还在

此外 `last_run` 字段被 48h 窗口约束：当卡顿时间超过 48h，detail 显示 `last_run=never`，丢失"上次成功是何时"这一关键诊断信息。

---

## 3. 修复（已在工作区落盘，待提交）

**`packages/brain/src/rumination.js`**
- `digestLearnings` 中分别捕获 NotebookLM 主路与 callLLM fallback 的失败原因（`notebookFailureReason`、`llmFailureReason`），覆盖 try/catch 异常 + empty/short response 两类失败
- 双路 LLM 全失败时写结构化事件 `cecelia_events.rumination_llm_failure`，payload 含：
  - `notebook_error`、`llm_error`
  - `batch_size`、`learning_ids`
- 写事件失败不阻塞主流程

**`packages/brain/src/capability-probe.js`**
- `probeRumination` 拆为两次 SQL 查询：
  - 48h 计数（决定 `cnt > 0` 通路）
  - 全局 `max(created_at)`（用于 detail 显示真实 last_run）
  - 结果：`last_run=never` 仅在 `synthesis_archive` 表完全空时出现
- 当 livenessTag = `degraded_llm_failure` 时，查询最近一次 `rumination_llm_failure` 事件，把 notebook + llm 错误摘要拼到 detail 末尾
- 查询失败不阻塞 probe 返回

**`packages/brain/src/__tests__/capability-probe-rumination.test.js`**
- 新增 3 条断言：`last_run` 全局查询语义、`rumination_llm_failure` 查询、detail 透出格式

---

## 4. 验证

- 单元测试：`vitest run capability-probe-rumination rumination*` → 77/77 PASS
- ESLint：0 error, 0 warning（变更文件）
- 探针真值：需 deploy 后观察 1 个 probe 周期（≥1h），detail 末尾应出现 `last_llm_failure: notebook=... llm=...`，运维据此一眼定位

**仍需在生产侧确认的事项**（本次代码 patch 不能解决）：
- NotebookLM bridge 的实际错误（需查最近一次 `rumination_llm_failure` 事件）
- Anthropic API 余额/账号状态（参考 raise('P0', ...) 告警通道）
- 必要时手动触发 `runRuminationForce()` 验证链路恢复

---

## 5. 不再发生的措施

1. 任何外部依赖（LLM、CLI bridge）失败的探针，detail 必须包含**最近一次具体错误**，不能只给"通用失败"标签
2. `dispatchAutoFixes` 的 RCA prompt 已经吃 `f.detail`，本修复后自动修复任务的 prompt 自带 LLM 根因，避免空转
3. 后续可考虑给 `rumination_llm_failure` 事件加 24h 时间窗约束查询，避免显示陈旧错误（当前依赖 livenessTag 由 24h 心跳决定，已有间接约束）

---

## 6. 跟进 Action

- [ ] 把工作区改动开 PR（`fix/rumination-probe-forensic`）→ brain-ci.yml 通过 → merge
- [ ] Deploy 后检查 1 个完整 probe 周期，确认 detail 末尾有 LLM 错误摘要
- [ ] 根据真实错误处理：
  - 若 `notebook_error` 是 timeout/auth → 修复 NotebookLM CLI bridge
  - 若 `llm_error` 是余额/quota → 走凭据 skill 补余额或切账号
  - 若两路同时挂 → 检查 Brain 出网/DNS
- [ ] 24h 后回查 `cecelia_events.rumination_llm_failure` 频次，应降到 0 或显著下降
