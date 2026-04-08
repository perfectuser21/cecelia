# Learning: sprint_contract_propose verdict 提取失败 — 纯文本 fallback 缺失

**分支**: cp-04080651-5050a0fd-45a1-4fa9-98d1-43f3ec  
**日期**: 2026-04-08

---

### 根本原因

`execution.js` 的 `sprint_contract_propose` 完成回调中，`extractVerdictFromResult` 函数仅能识别 `"verdict":"PROPOSED"` 的 JSON 格式。

当 cecelia-run 传回的 result 是：
1. `null`（出现问题时的默认值）
2. 纯文本字符串（如 `"Contract done. PROPOSED"`）
3. Claude SDK JSON（`{type, result: "...含 PROPOSED 单词但非 JSON..."}`)

这三种情况下，提取结果均为 `null` → `proposeVerdict !== 'PROPOSED'` → GAN 守卫阻断 → Reviewer 永远不派。

`sprint_contract_review` 有类似但程度较轻的问题（默认 REVISION，不会卡死流程，但解析不完整）。

---

### 下次预防

- [ ] 凡从 AI agent 输出中提取 verdict 的逻辑，必须覆盖三种格式：
  1. 直接对象 `{verdict: "..."}` 
  2. Claude SDK JSON `{result: "...纯文本..."}` 中的 `result` 字段
  3. 纯文本正则（`\bVERDICT_WORD\b`）
- [ ] 新增 verdict 提取逻辑时，参考 `sprint_evaluate`（已有三层 fallback）
- [ ] `extractVerdictFromResult` 函数名暗示只做结构化提取，不覆盖纯文本 → 调用方需自行补充 fallback
- [ ] 验证 verdict 提取是否工作，可直接检查 DB：`SELECT result FROM tasks WHERE task_type='sprint_contract_propose' ORDER BY created_at DESC LIMIT 5`，result 全为 null 即说明提取失败
