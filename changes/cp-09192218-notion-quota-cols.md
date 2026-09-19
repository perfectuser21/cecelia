## Brain {VERSION} — 刀2 Notion 收尾：Ops Agent 图谱库补配额三列并按 provider 填值

- PRD 第 4 步（判定点：并入现有 Agents&机器 库加列）在 #5411 只落了列定义：既有库无 FiveHourPct/SevenDayPct/QuotaUpdatedAt，push 也不填值。
- `ops-notion-schema.js` 的 `diffMissingProps`（"缺列即补"）此前无人调用——新增 `ops-quota-notion.js: ensureOpsDbProps`，ops-notion-push 每轮先对四库幂等补缺列（只发缺的）。
- agent 行按 `meta.model` 推 provider（claude/codex/grok），取该 provider 下 status=ok 且 7d 最紧张的账号填三列；无匹配不发（禁编造 0）。
