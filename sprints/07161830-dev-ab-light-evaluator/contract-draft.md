# Contract Draft — 建制W5: /dev A/B 轨补轻量 Evaluator

- task_id: 4950d174-cfcd-4a81-b078-0d695a78f103
- sprint_dir: sprints/07161830-dev-ab-light-evaluator
- 挂靠决策: 145014a4③
- 日期: 2026-07-16
- proposer: harness-contract-proposer (round 1)

---

## 背景

决策 145014a4③ 要求「改行为必有 evaluator 真跑复核」。当前 /dev SKILL.md 12 步结构中，push 前缺少对 `[BEHAVIOR]` 条目的自动真执行验证步骤，导致 DoD 断言形同虚设。本 sprint 在 engine 侧（packages/engine）新增轻量 evaluator 步骤，不 spawn 子 session、不调 judge，原地逐条真跑 `Test:` 命令并留证据。

---

## 范围

- **包含**：`packages/engine/skills/dev/steps/light-evaluator.md`（新增步骤文件）
- **包含**：`packages/engine/skills/dev/SKILL.md`（插入新步骤引用，push 前第 11 步附近）
- **包含**：`packages/engine/package.json` 版本 19.4.4 → 19.5.0
- **包含**：`packages/engine/CHANGELOG.md` 新增 [19.5.0] 条目
- **包含**：`packages/engine/feature-registry.yml` 新增 light-evaluator 条目
- **包含**：`packages/engine/scripts/devgate/check-dod-purity.cjs` 兼容新步骤（不报误错）
- **包含**：`tests/light-evaluator.test.cjs`（先写红灯测试，commit 1 = Red）
- **不包含**：Brain 侧改动、dashboard、独立 CI job

---

## E2E 验收

### 场景 A：Happy Path — [BEHAVIOR] DoD 条目全部通过

**前提**：sprint 目录下存在含 `[BEHAVIOR]` 条目的 `contract-dod-ws*.md`，所有 `Test:` 命令真实可执行

**步骤**：
1. 执行 `/dev` 改动涉及 `[BEHAVIOR]`
2. push 前步骤自动扫描 sprint 下 `contract-dod-ws*.md`，提取所有 `[BEHAVIOR]` 条目 `Test:` 字段
3. 逐条执行，每条 exit_code=0
4. 写 `verify-record.json` 到 sprint 目录

**验收断言**：
- `verify-record.json` 存在且字段包含 `{cmd, exit_code: 0, tail5, timestamp}`
- 终端打印每条命令 PASS 进度
- push 未被阻断

### 场景 B：失败路径 — 某条命令 exit_code ≠ 0

**步骤**：
1. sprint 下有 `[BEHAVIOR]` DoD，但某条 `Test:` 命令故意失败（`exit 1`）
2. 轻量 evaluator 执行该命令

**验收断言**：
- 终端输出命令名 + `exit_code=1` + 输出尾 5 行
- 整步 FAIL，push 被阻断（evaluator 脚本 exit 1）
- `verify-record.json` 记录失败条目

### 场景 C：豁免路径 — 无 [BEHAVIOR] 条目

**步骤**：
1. sprint 下 DoD 文件仅含 `[ARTIFACT]` 条目，无 `[BEHAVIOR]`

**验收断言**：
- `verify-record.json` 含 `{skipped: true, reason: "no [BEHAVIOR] entries"}`
- evaluator 步骤 exit 0，push 不被阻断

### 场景 D：版本同步断言

**验收断言**：
- `packages/engine/package.json` 中 `version` 字段 = `19.5.0`
- SKILL.md frontmatter `version:` = `19.5.0`（或对应版本）
- CHANGELOG.md 顶部含 `[19.5.0]` 条目
- `feature-registry.yml` 含 `light-evaluator` 条目

### 场景 E：SKILL.md 引用断言

**验收断言**：
- `grep -q 'light-evaluator' packages/engine/skills/dev/SKILL.md` exit_code=0

---

## 未覆盖真实链路清单

| # | 未覆盖链路 | 原因 / 风险 |
|---|------------|-------------|
| 1 | 超时 60s 自动 FAIL 路径 | 需要慢命令才能触发，CI 环境不便引入 sleep 60+ 的命令；留作手动验证 |
| 2 | verify-record.json 追加模式（多轮 push） | 首版实现为覆盖写；追加模式是 NFR，留后续 sprint |
| 3 | 跨 sprint 多 DoD 文件并行扫描 | 当前 sprint 场景为单 sprint，多 sprint 并发未测试 |
| 4 | SKILL.md push 前步骤真实触发（需完整 /dev 会话） | E2E 需要完整 /dev 运行环境，本 sprint 以单元测试 + manual 命令覆盖 |
| 5 | check-dod-purity.cjs 兼容性（新步骤不报误错） | 通过 manual bash 命令验证，未纳入自动化测试 |

---

## 风险与约束

- INV-02：轻量验收步不 spawn 独立 session，不调 judge，只原地真跑
- INV-04：任一命令 exit_code ≠ 0 整步 FAIL，阻断 push（不允许继续）
- INV-06：版本 bump 5 文件同步
- 本 sprint 自身 DoD `[BEHAVIOR]` 条目按新规矩真跑，留 verify-record.json 证据（吃狗粮）

---

## Test Contract

| BEHAVIOR | Test File | it() 描述（子串） |
|----------|-----------|-----------------|
| B-01 light-evaluator.md 存在 | ../../tests/regression/dev-ab-light-evaluator/light-evaluator.test.cjs | B-01: light-evaluator.md 存在 |
| B-02 SKILL.md 引用 | ../../tests/regression/dev-ab-light-evaluator/light-evaluator.test.cjs | B-02: SKILL.md 引用 light-evaluator |
| B-03 版本 19.5.0 | ../../tests/regression/dev-ab-light-evaluator/light-evaluator.test.cjs | B-03: engine package.json 版本为 19.5.0 |
| B-04 CHANGELOG 含 19.5.0 | ../../tests/regression/dev-ab-light-evaluator/light-evaluator.test.cjs | B-04: CHANGELOG.md 含 [19.5.0] 条目 |
| B-05 feature-registry 含 light-evaluator | ../../tests/regression/dev-ab-light-evaluator/light-evaluator.test.cjs | B-05: feature-registry.yml 含 light-evaluator |
| B-06 豁免写 skip 记录 | ../../tests/regression/dev-ab-light-evaluator/light-evaluator.test.cjs | B-06b: 豁免路径输出 skipped 标记 |
| B-07 脚本可 node 调用 | ../../tests/regression/dev-ab-light-evaluator/light-evaluator.test.cjs | B-07: light-evaluator.cjs 存在 |
| B-08 Red 测试文件存在 | ../../tests/regression/dev-ab-light-evaluator/light-evaluator.test.cjs | B-08: 本 Red 测试文件存在 |
