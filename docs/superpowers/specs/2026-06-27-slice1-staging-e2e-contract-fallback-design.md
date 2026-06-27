# Slice1 设计：staging-e2e 兜底解析 contract_content（解 P0 staging 永久 SKIP）

> 日期：2026-06-27 ｜ 路径 A（Bug）｜ 范围 thin（止血，治本在 Slice2）

## 问题（根因，已实锤）

`packages/brain/src/staging-e2e-runner.js` 的 `loadE2eAcceptance` 只 `SELECT e2e_acceptance`，为空即返回 `null` → `runStagingE2E` `finalize('SKIP','no_contract')` → `decidePromote` 收到 SKIP → promote 永不触发。每次 harness run 物理上都死在 staging 之前，到不了 release→deploy(5211)。

**DB 实测（171 条 initiative_contracts）**：
- `e2e_acceptance` 非空：仅 **1** 条 → 列几乎零写入（写入链断点，Slice2 治本）。
- `contract_content` 含 `## E2E` 段：**153** 条；含 ` ```bash ` 块：**159** 条 → 兜底数据源充足。

## 方案

不动写入链（Slice2 才治本），只在读取侧加兜底解析。

### 组件 1：`parseE2eAcceptanceFromContract(contractContent, initiativeId)`（新增，导出，纯函数）

- 输入：合同 markdown 文本 + initiativeId。
- 抽取 `## E2E 验收` 段：从 `/^##\s*E2E/m` 起，到下一个 `^## ` 或 EOF。
- 段内抽所有 ` ```bash ` / ` ```sh ` 围栏块。
- 无段或无块 → 返回 `null`（让上层走 SKIP）。
- 有块 → 构造：
  ```js
  { scenarios: [{
      name: 'Golden Path E2E (fallback parsed from contract_content)',
      covered_tasks: [initiativeId || 'fallback'],
      commands: blocks.map(b => ({ cmd: b })),   // command 是 {cmd} 对象，非裸串
  }] }
  ```
- 返回前内部跑一遍 `normalizeAcceptance`，**抛错则返回 `null`**（走 SKIP 比 FAIL 省资源：FAIL 时 deploy 已白跑）。

### 组件 2：`loadE2eAcceptance`（改）

- `SELECT e2e_acceptance, contract_content`（原只取一列）。
- `e2e_acceptance` 非空 → 原样返回（**保留现有行为，零回归**）。
- 否则 `contract_content` 非空 → `parseE2eAcceptanceFromContract(contract_content, initiativeId)`（可能 null）。
- 都空 → `null`。
- 导出该函数供测试。

## 数据流

`runStagingE2E` → `loadAcceptance(pool, initiativeId)` →（命中兜底）`{scenarios:[...]}` → `runScenarios` → `runStagingCommand({cmd})`（逐 scenario 跑，端口重写不变）。

## 不做（边界）

- 不改 `harness-initiative.graph.js` / `harness-gan.graph.js` 写入链（Slice2）。
- 不改 `normalizeAcceptance` 校验规则（兜底输出必须迎合它，不放宽它）。
- 不碰 windows `.ps1` 固化（Slice3）。

## 测试策略（unit，既有 mock 模式：`vi.mock` task-updater/db.js + 注入 `opts.pool`）

Regression test（永久留 CI）：
1. parser：含 `## E2E 验收` + ` ```bash ` 块的 markdown → `scenarios.length === 1`、过 `normalizeAcceptance`、`commands[0].cmd` 含脚本体关键行。
2. parser：无 `## E2E` 段 → `null`。
3. parser：有 `## E2E` 段但无 bash 块 → `null`。
4. `loadE2eAcceptance`：`e2e_acceptance=NULL` + `contract_content` 有块 → 非空 scenarios（**复现 bug 的核心断言**）。
5. `loadE2eAcceptance`：`e2e_acceptance` 非空 → 原样返回（行为保留）。

## DevGate

`facts-check` / `check-version-sync` / `check-dod-mapping` + bump brain 版本（4 处同步）；push 前 `node --check staging-e2e-runner.js` 冒烟。
