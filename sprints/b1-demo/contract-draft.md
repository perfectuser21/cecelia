# Sprint Contract Draft (Round 1) — Initiative B1 端到端 Harness Demo

> **被测对象**: 4 份 b1-demo 演示产物（schema.md / config.json / query.md / selfcheck.sh）
> **目标**: 让 Harness v2 Planner→Runner→Generator→Evaluator 自检路径有稳定 fixture
> **范围限定**: 全部产物落 `sprints/b1-demo/`；不改 packages/brain，不引入新依赖，不改 CI/migrations/docs

---

## Feature 1: 模块 Schema 描述（schema.md）

**行为描述**:
b1-demo 模块在 `sprints/b1-demo/schema.md` 声明自身契约，使其他组件能够通过纯文本解析获得三件信息：模块标识、语义版本号、≥3 条字段定义。Schema 文件无可执行逻辑，仅靠文本结构表达契约，是后续 ws2/ws3/ws4 一致引用的"模块名/版本/字段"事实来源。

**硬阈值**:
- `module:` 行存在且值严格等于 `b1-demo`
- `version:` 行存在且值匹配 `^\d+\.\d+\.\d+$`
- 含二级标题 `## Fields`，其下以 `- ` 开头的列表项数量 ≥ 3
- 文件总行数 ≥ 10（避免空文件假实现）

**BEHAVIOR 覆盖**（落在 `tests/ws1/schema.test.ts`）:
- `it('declares module identifier as b1-demo')`
- `it('declares semver-compliant version')`
- `it('lists at least 3 fields under Fields section')`
- `it('rejects empty or single-line stub schema')`

**ARTIFACT 覆盖**（落在 `contract-dod-ws1.md`）:
- `sprints/b1-demo/schema.md` 文件存在
- 文件首部含 `module: b1-demo` 字面量
- 文件含 `## Fields` 章节标题
- 文件含 `version:` 字段

---

## Feature 2: 运行配置（config.json）

**行为描述**:
b1-demo 模块的运行配置位于 `sprints/b1-demo/config.json`，必须是合法 JSON。Runner 启动模块时，读取该文件并依据 `enabled` 字段决定是否启用；若启用，则将 `entrypoint` 作为入口调用线索。配置文件的 `module` 字段必须与 schema.md 声明一致，确保跨文件契约自洽。

**硬阈值**:
- `JSON.parse(fileContent)` 不抛异常
- `parsed.module === "b1-demo"` 严格相等
- `parsed.enabled === true` 严格相等
- `parsed.entrypoint` 是 `typeof === "string"` 且 `length > 0`
- `parsed.version` 与 schema.md 中 `version:` 值一致

**BEHAVIOR 覆盖**（落在 `tests/ws2/config.test.ts`）:
- `it('parses as valid JSON')`
- `it('declares module === b1-demo')`
- `it('declares enabled === true')`
- `it('exposes non-empty string entrypoint')`
- `it('keeps version consistent with schema.md')`

**ARTIFACT 覆盖**（落在 `contract-dod-ws2.md`）:
- `sprints/b1-demo/config.json` 文件存在
- 内容含 `"module"` `"enabled"` `"entrypoint"` 三个 JSON key
- 不含 trailing comma（避免非法 JSON 残留）

---

## Feature 3: 查询入口契约（query.md）

**行为描述**:
`sprints/b1-demo/query.md` 描述外部组件查询 b1-demo 模块的接口约定，至少包含一个可复制粘贴的 bash 调用示例（含模块标识 `b1-demo`），以及一段 `## Expected Output` 章节给出预期输出形态。该文档让 Evaluator 在零知识情况下也能按图索骥地构造调用 + 比对输出。

**硬阈值**:
- 文件含 ≥ 1 个 ` ```bash ` 代码块
- 至少 1 个 bash 代码块体内含字面量 `b1-demo`
- 含二级标题 `## Query` 与 `## Expected Output`
- `## Expected Output` 章节下含 ≥ 1 个代码块（任意语言）

**BEHAVIOR 覆盖**（落在 `tests/ws3/query.test.ts`）:
- `it('contains at least one bash code block')`
- `it('references b1-demo inside a bash example')`
- `it('declares ## Query and ## Expected Output sections')`
- `it('provides non-empty Expected Output sample')`

**ARTIFACT 覆盖**（落在 `contract-dod-ws3.md`）:
- `sprints/b1-demo/query.md` 文件存在
- 含 ` ```bash ` 围栏标识
- 含 `## Query` 与 `## Expected Output` 字面量

---

## Feature 4: 自检脚本（selfcheck.sh）

**行为描述**:
`sprints/b1-demo/selfcheck.sh` 是一个 bash 脚本，依次验证前 3 个产物存在且合规：检查 schema.md 含 `module: b1-demo`、config.json 是合法 JSON 且 enabled=true、query.md 含 bash 代码块。当四个文件齐全且全部校验通过时 exit 0；任意一项缺失或不合规时 exit 非 0。脚本仅依赖 bash + node（用于 JSON 校验），不依赖任何全局二进制。

**硬阈值**:
- 首行 shebang 形如 `#!/usr/bin/env bash` 或 `#!/bin/bash`
- selfcheck.sh 在自身所在目录解析三件被检产物（实现要求：脚本内部 `cd "$(dirname "$0")"` 或等价 cwd 切换；测试中以 `spawnSync('bash', ['./selfcheck.sh'], { cwd: fixtureDir })` 复用此语义）
- 全产物齐全场景：`bash sprints/b1-demo/selfcheck.sh` 退出码 0
- schema.md 临时改名隐藏后：退出码 ≠ 0
- config.json 内容替换为非法 JSON 后：退出码 ≠ 0
- query.md 内容替换为不含 `b1-demo` 的版本后：退出码 ≠ 0

**BEHAVIOR 覆盖**（落在 `tests/ws4/selfcheck.test.ts`）:
- `it('exits 0 when all four artifacts are present and valid')`
- `it('exits non-zero when schema.md is missing')`
- `it('exits non-zero when config.json is invalid JSON')`
- `it('exits non-zero when query.md lacks b1-demo reference')`

**ARTIFACT 覆盖**（落在 `contract-dod-ws4.md`）:
- `sprints/b1-demo/selfcheck.sh` 文件存在
- 首行含 shebang
- 文件体内含 `b1-demo` 字面量（保证脚本针对本模块）

---

## Workstreams

workstream_count: 4

### Workstream 1: schema.md

**范围**: 产出 `sprints/b1-demo/schema.md`，含 `module: b1-demo` / `version: x.y.z` / `## Fields` 三段，字段列表 ≥ 3 条
**大小**: S（< 30 行）
**依赖**: 无
**BEHAVIOR 覆盖测试文件**: `tests/ws1/schema.test.ts`

### Workstream 2: config.json

**范围**: 产出 `sprints/b1-demo/config.json`，是合法 JSON，含 module/enabled/entrypoint/version 字段
**大小**: S（< 20 行）
**依赖**: 概念上引用 ws1 的 module/version 命名一致；执行顺序上无硬依赖（PRD 指定线性 DAG，按 ws1→ws2 顺序）
**BEHAVIOR 覆盖测试文件**: `tests/ws2/config.test.ts`

### Workstream 3: query.md

**范围**: 产出 `sprints/b1-demo/query.md`，含 `## Query` + bash 示例 + `## Expected Output` + 输出样本
**大小**: S（< 30 行）
**依赖**: 概念上引用 ws1 的 module 名；执行顺序 ws2→ws3
**BEHAVIOR 覆盖测试文件**: `tests/ws3/query.test.ts`

### Workstream 4: selfcheck.sh

**范围**: 产出 `sprints/b1-demo/selfcheck.sh`，校验前 3 个产物，齐全合规返回 0，缺/损返回非 0
**大小**: S（< 60 行）
**依赖**: ws1+ws2+ws3 完成后才能完整跑通（执行顺序 ws3→ws4）
**BEHAVIOR 覆盖测试文件**: `tests/ws4/selfcheck.test.ts`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `sprints/b1-demo/tests/ws1/schema.test.ts` | declares module / declares semver / lists ≥3 fields / rejects stub | `npx vitest run sprints/b1-demo/tests/ws1/` → 4 failures（schema.md 不存在 → ENOENT） |
| WS2 | `sprints/b1-demo/tests/ws2/config.test.ts` | parses JSON / module === b1-demo / enabled === true / non-empty entrypoint / version 一致 | `npx vitest run sprints/b1-demo/tests/ws2/` → 5 failures（config.json 不存在 → ENOENT） |
| WS3 | `sprints/b1-demo/tests/ws3/query.test.ts` | bash block / b1-demo ref / sections / sample | `npx vitest run sprints/b1-demo/tests/ws3/` → 4 failures（query.md 不存在 → ENOENT） |
| WS4 | `sprints/b1-demo/tests/ws4/selfcheck.test.ts` | exits 0 happy path / exits non-zero on missing schema / on invalid JSON / on missing b1-demo in query | `npx vitest run sprints/b1-demo/tests/ws4/` → 4 failures（selfcheck.sh 不存在 → spawn ENOENT） |

**总计**: 17 个 it() 块，预期 17 个 FAIL（实现尚未存在）。

---

## 假设与约束

- **[ASSUMPTION]** 仓库 root 含 vitest 1.6.1（packages/brain devDep 已声明）；CI 与 Reviewer 环境会通过 `npm install` 让 `npx vitest` 可用。Proposer 本地若无 node_modules，将通过"测试文件 import 路径解析失败"作为静态 Red 证据，详见 `red-evidence.txt`。
- **[ASSUMPTION]** PRD 范围 "不引入新依赖" 指 Generator 实施阶段，不影响 Proposer/Reviewer 阶段使用 vitest（已存在于 monorepo 声明中）。
- **[ASSUMPTION]** 测试中对 `selfcheck.sh` 的执行使用 `child_process.spawnSync('bash', [path])`，避开权限位依赖（与 PRD "DoD 应显式 bash 调用绕过" 边界情况一致）。
- 所有产物路径使用 POSIX 风格相对路径，从仓库根 cwd 启动测试。
