# Design — codex/grok headless supervisor 三态解析对齐真实 CLI 输出

日期：2026-07-23 ｜ 任务：ab41227c ｜ 决策：78747a80（bug-fix）｜ Issue 血统：evaluator 静态 grep 假 PASS

## 问题（已用真实 CLI 复现，fixture 原文在案）

`scripts/codex-supervisor.mjs` / `scripts/grok-supervisor.mjs` 的 `parseDecision()` / `extractSessionId()`
按"顶层字段 + 逐行 JSONL"假设解析，但真实输出：

**codex `exec --json`**（JSONL 事件流，实测 2026-07-23，codex CLI via ~/.codex-team1）：

```jsonl
{"type":"thread.started","thread_id":"019f8c99-884d-7461-9443-8630d361f34d"}
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"{\"decision\":\"complete\"}"}}
{"type":"turn.completed","usage":{...}}
```

- 决策 JSON 嵌在 `item.completed` 事件的 `item.text` 字符串里 → 顶层匹配永远落空 → 永远 fallback `continue`。
- `thread_id` 在顶层 → codex 的 session 提取**现状可用**（保留并加行为测试锁死）。

**grok `-p ... --output-format json`**（单个多行 pretty JSON 对象，grok 0.2.106 实测）：

```json
{
  "text": "{\"decision\":\"complete\"}",
  "stopReason": "EndTurn",
  "sessionId": "019f8c99-b66d-72e2-b4b7-e41cbf65bace",
  ...
}
```

- 逐行 `JSON.parse` 每行都不是合法 JSON → 全灭；
- 决策嵌在 `.text`；
- 真实字段是驼峰 `sessionId`，代码找 `session_id`/`thread_id` → 永远 null → `--resume` 永远不带 → 每轮开新会话，违背"必须延续同一 session"（INV-5）。

现有守卫为何没拦住：`tests/regression/codex-grok-launcher-supervisor/*.test.mjs` 是**纯静态源码 grep 断言**
（文件头自认"不启动 fake binary"），且**未登记进 `regression-contract.yaml`**，PR CI 根本不执行——双重失守。

## 方案（三选一，选 A）

- **A（选定）：共享解析 lib + 行为测试 + contract 登记。** 新建 `scripts/lib/supervisor-parse.mjs`，两个
  supervisor import；测试只 import lib（绕开 supervisor 模块顶部 `HARNESS_TASK_ID` 缺失即 `process.exit(1)`
  的 import 副作用，无需入口守卫重构）。Research 已证：supervisor 只从仓库原地 `node` 执行、runner 镜像不打包
  scripts/、无复制安装场景 → 相对 import 安全。
- B（弃）：两文件各自内联修 + export 供测试 —— 逻辑重复 ×2，且 import 时顶层 exit 副作用需要入口守卫重构，改动面反而大。
- C（弃）：不 export，用 fake bin 起真进程测 —— 重、慢、脆，测的还是同一批纯函数。

## 实现

`scripts/lib/supervisor-parse.mjs` 导出：

- `extractDecisionFromText(text)`：`text.match(/\{[\s\S]*\}/)` 取 JSON 子串 → parse → 读
  `decision`/`status`/`outcome` 三字段映射三态；解析失败/无命中 → `null`。
- `parseCodexDecision(stdout)`：逐行 JSONL；顶层三字段兼容保留；`type==='item.completed' &&
  item.type==='agent_message'` → `extractDecisionFromText(item.text)`，**取最后一条命中**（最终答复优先）；
  无命中 → `'continue'`（保守策略不变）。
- `extractCodexSessionId(stdout)`：现有逻辑原样迁移（`thread_id ?? thread.id ?? session_id ?? session.id`）。
- `parseGrokDecision(stdout)`：先整块 `JSON.parse(stdout)` → 顶层三字段 → 嵌套 `.text` 走
  `extractDecisionFromText`；整块失败 → 逐行 JSONL 兜底（向前兼容）；无命中 → `'continue'`。
- `extractGrokSessionId(stdout)`：整块 parse → `sessionId ?? session_id ?? session.id ?? thread_id`；
  失败 → 逐行兜底。

两个 supervisor 删除内联 `parseDecision`/`extractSessionId`，改 import；其余（主循环/Brain 回写/外部验收）零改动。
**明确不碰**：`SUPERVISOR_DEADLINE_SECONDS`（在跑 kernel sprint 1b997ed6 的 PRD 范围）。

## 测试（先红后绿，全部进 PR CI）

新文件 `tests/regression/codex-grok-launcher-supervisor/supervisor-parse-behavior.test.mjs` +
`__fixtures__/codex-exec-real-complete.jsonl`、`__fixtures__/grok-p-real-complete.json`（2026-07-23 真实
CLI 输出**原文逐字**，非手搓）：

1. codex 真实 fixture → `parseCodexDecision === 'complete'`（现状红：返回 continue）
2. codex 真实 fixture → `extractCodexSessionId === '019f8c99-884d-…'`（锁住现状可用路径）
3. codex 派生 blocked/continue 变体（同事件结构改 text）→ 对应三态
4. codex agent_message 无决策 JSON → `'continue'` 保守 fallback
5. grok 真实 fixture → `parseGrokDecision === 'complete'`（现状红）
6. grok 真实 fixture → `extractGrokSessionId === '019f8c99-b66d-…'`（现状红：null）
7. grok 派生 blocked 变体 → `'blocked'`
8. 非 JSON/空 stdout → `'continue'` + `null`，不抛异常

`regression-contract.yaml` `golden_paths[]` 新增条目（`trigger: [PR, Release]`，
`test_command: node tests/regression/codex-grok-launcher-supervisor/supervisor-parse-behavior.test.mjs`），
终结"毕业即孤儿"——这是本 bug 的哨兵（纯逻辑接缝 → CI test 即守卫，commit-1 红 = proven-to-fire）。

## Out of scope（同病兄弟，另案不混）

- `docker/cecelia-runner/entrypoint.sh` jq 路径（provider-contract，已会抽 `.sessionId`，另有自己的契约测试）；
- `packages/brain/src/orchestrator/providers/{codex,grok}.js`、`executor.js` codex review 正则路径——
  orchestrator 是在跑 kernel sprint 1b997ed6 的活跃改动面，本 PR 碰它必撞车；
- supervisor 与 entrypoint 的接线（Research 证实 supervisor 目前"已落库未接线"）。

## 回滚

单 PR revert 即回旧行为；lib 无状态纯函数，无迁移无部署面（scripts/ 不进镜像、不需 rebuild）。
