# Engine 违规清单（T2 审计产出）

生成时间: 2026-04-18
审计范围: `/Users/administrator/perfect21/cecelia/packages/engine/`
审计人: T2 Agent（只读审计）

---

## A. 版本号同步检查

**目标统一值**: `14.17.4`（以 `VERSION` / `package.json` / `regression-contract.yaml` 三方一致为准）

| # | 文件（相对 repo 根） | 行号 | 当前值 | 期望值 | 状态 |
|---|---------------------|------|--------|--------|------|
| A1 | `packages/engine/VERSION` | 1 | `14.17.4` | `14.17.4` | ✅ OK |
| A2 | `packages/engine/package.json` | 29 | `"version": "14.17.4"` | `14.17.4` | ✅ OK |
| A3 | `packages/engine/.hook-core-version` | 1 | `14.17.4` | `14.17.4` | ✅ OK |
| A4 | `packages/engine/skills/dev/SKILL.md` | 3 | `version: 7.2.0` | `14.17.4`（或保留 skill 内部版本 7.2.0 并从 `check-version-sync.sh` 白名单移除） | ❌ 不一致 |
| A5 | `packages/engine/regression-contract.yaml` | 31 | `version: 14.17.4` | `14.17.4` | ✅ OK |

**结论**: 5 处中 A1/A2/A3/A5 一致（14.17.4），仅 **A4**（`skills/dev/SKILL.md` frontmatter）显著落后为 `7.2.0`。

**修复动作（A4）**: 二选一
- 方案 1（推荐）：把 `SKILL.md` frontmatter `version:` 改成 `14.17.4`，并把现有 `changelog:` 的 `7.x.x` 条目改成对齐 Engine 主版本号（或移到 `internal_version:` 字段）
- 方案 2：保留 skill 内部独立版本号，但需在 `scripts/check-version-sync.sh` 中把 SKILL.md 从检查对象中移除，避免 DevGate 误报

**关联事实**: A4 的 `updated: 2026-04-15` 与 `regression-contract.yaml:32 updated: 2026-04-15` 一致，说明二者是同一天动过，但版本号语义不同步。

---

## B. TODO / FIXME / XXX / HACK 占位符

仅列"**真实占位符**"（被用作未完成标记），排除：
- 正则字符串里的 `XXX+`（凭据校验器模式）
- 代码中解释性 "XXX" 提示（如 `process.env.XXX`）
- 已实装的 TODO 拦截逻辑（`devgate-fake-test-detection.test.cjs` 等测试/实装文件）
- 注释里提到 TODO 是"被禁止的对象"而非"占位"的地方（如 `01-spec.md:169/182/321`、`00.5-enrich.md:76`）

### B.1 真占位符（P0 必修）

| # | 文件（相对 repo 根） | 行号 | 当前内容 | 建议处理 |
|---|---------------------|------|---------|---------|
| B1 | `packages/engine/skills/dev/scripts/fetch-task-prd.sh` | 331 | ``test_cmd=$(echo "$initiative_dod_json" \| jq -r ".[$i].test // "manual:TODO"")`` | 把 `"manual:TODO"` 改为真正可执行的 fallback 命令（如 `"manual:node -e \"process.exit(1)\""` 故意失败，或改成报错退出让 /dev 显式提示"Initiative DoD 条目缺 test 字段"） |
| B2 | `packages/engine/skills/dev/scripts/fetch-task-prd.sh` | 356 | `Test: manual:TODO`（通用模板第 1 条"功能按 PRD 实现"） | 替换为具体命令，如 `manual:bash -c "echo 请补充真实测试命令; exit 1"`，或改文案为"**占位符必须在开发前替换**"并让 devgate 的 fake-test-detection 拒绝放行 |
| B3 | `packages/engine/skills/dev/scripts/fetch-task-prd.sh` | 358 | `Test: manual:TODO`（通用模板第 2 条"手动测试通过"） | 同 B2 |
| B4 | `packages/engine/skills/dev/scripts/fetch-task-prd.sh` | 363 | `Test: manual:TODO`（通用模板第 3 条"测试脚本存在且通过"） | 同 B2，或者直接提供真 fallback：`manual:node -e "require('fs').readdirSync('tests')"` |

> 矛盾点：`packages/engine/tests/devgate-fake-test-detection.test.cjs` 明确禁止 `manual:TODO`（L40-42, L174-189），但 `fetch-task-prd.sh` 自己生成的模板会产出这种被禁值 — 相当于 /dev 生成的 DoD 模板一开箱就通不过自己的 devgate。

### B.2 规范性提及（无需处理，列此以避免误判）

| 文件 | 行号 | 性质 |
|------|------|------|
| `packages/engine/hooks/credential-guard.sh` | 44-45 | `process.env.XXX` 和 `YOUR_XXX_KEY` 字符串是示例文案，非占位符 |
| `packages/engine/hooks/bash-guard.sh` | 70, 86 | 同上 |
| `packages/engine/regression-contract.yaml` | 1161 | 注释：`# TODO: W1 系列当前为 manual 测试...` — 建议保留或转为 GitHub issue |
| `packages/engine/skills/dev/steps/01-spec.md` | 169, 182, 321 | 规则文本："禁止 TODO 占位符"，非违规 |
| `packages/engine/skills/dev/steps/00.5-enrich.md` | 76 | 同上 |
| `packages/engine/tests/devgate-fake-test-detection.test.cjs` | 40-189 | TODO 检测测试套件，实装代码 |

---

## C. 悬空 / 外部引用（`superpowers:xxx` 及绝对路径）

**性质澄清**: 这些引用目标在 **Claude Code 运行时 plugins cache**（`~/.claude-account1/plugins/cache/superpowers-marketplace/superpowers/5.0.7/skills/...`）中**真实存在**，但：
1. 仓库内没有任何副本 → CI / 新机器 / 其他 agent 无法 resolve
2. 依赖 `superpowers-marketplace` plugin 已安装 + 版本号 5.0.7
3. 02-code.md:493 更出现了硬编码绝对路径 `~/.claude-account3/...`（引用了账号 3 的缓存）

所有悬空引用均在 `packages/engine/skills/dev/` 下。建议方案二选一：
- **方案 A（本地化）**：在 `packages/engine/skills/dev/prompts/<skill-name>/` 下提交副本，改引用路径
- **方案 B（锁版本 + 文档化前置）**：在 `SKILL.md` 顶部硬声明"需要 superpowers-marketplace >= 5.0.7"，并把 `superpowers:xxx/yyy.md` 替换为稳定 resolver（如 `$SUPERPOWERS_ROOT/skills/xxx/yyy.md`）

### C.1 `superpowers:<skill>/<file>.md` 悬空引用（子文件引用）

| # | 文件 | 行号 | 引用字符串 | 本地化目标（方案 A） | 上游实际位置（缓存） |
|---|------|------|-----------|--------------------|--------------------|
| C1 | `packages/engine/skills/dev/steps/02-code.md` | 99 | `superpowers:subagent-driven-development/implementer-prompt.md` | `packages/engine/skills/dev/prompts/subagent-driven-development/implementer-prompt.md` | `~/.claude-account1/plugins/cache/superpowers-marketplace/superpowers/5.0.7/skills/subagent-driven-development/implementer-prompt.md` ✓ |
| C2 | `packages/engine/skills/dev/steps/02-code.md` | 149 | `superpowers:subagent-driven-development/spec-reviewer-prompt.md` | `packages/engine/skills/dev/prompts/subagent-driven-development/spec-reviewer-prompt.md` | 同上 `.../subagent-driven-development/spec-reviewer-prompt.md` ✓ |
| C3 | `packages/engine/skills/dev/steps/02-code.md` | 210 | `superpowers:subagent-driven-development/code-quality-reviewer-prompt.md` | `packages/engine/skills/dev/prompts/subagent-driven-development/code-quality-reviewer-prompt.md` | 同上 `.../subagent-driven-development/code-quality-reviewer-prompt.md` ✓ |
| C4 | `packages/engine/skills/dev/steps/02-code.md` | 217 | `superpowers:test-driven-development/testing-anti-patterns.md` | `packages/engine/skills/dev/prompts/test-driven-development/testing-anti-patterns.md` | `~/.claude-account1/plugins/cache/.../test-driven-development/testing-anti-patterns.md` ✓ |

### C.2 `superpowers:<skill>` 悬空引用（skill 级别）

这些引用的是 skill 整体而非具体文件，补救方式是把 skill 的 `SKILL.md` 本地化。

| # | 文件 | 行号 | 引用字符串 | 本地化目标（方案 A） |
|---|------|------|-----------|--------------------|
| C5 | `packages/engine/skills/dev/SKILL.md` | 136 | `superpowers:brainstorming` + `superpowers:writing-plans` | `prompts/brainstorming/SKILL.md` + `prompts/writing-plans/SKILL.md` |
| C6 | `packages/engine/skills/dev/SKILL.md` | 137 | `superpowers:subagent-driven-development` | `prompts/subagent-driven-development/SKILL.md` |
| C7 | `packages/engine/skills/dev/steps/02-code.md` | 84 | `superpowers:test-driven-development` + `superpowers:verification-before-completion` | `prompts/test-driven-development/SKILL.md` + `prompts/verification-before-completion/SKILL.md` |
| C8 | `packages/engine/skills/dev/steps/02-code.md` | 139 | `superpowers:requesting-code-review` | `prompts/requesting-code-review/SKILL.md`（缓存里附带还有 `code-reviewer.md`，建议一起搬） |
| C9 | `packages/engine/skills/dev/steps/02-code.md` | 161 | `superpowers:receiving-code-review` | `prompts/receiving-code-review/SKILL.md` |
| C10 | `packages/engine/skills/dev/steps/02-code.md` | 163 | `superpowers:receiving-code-review` | 同 C9 |
| C11 | `packages/engine/skills/dev/steps/02-code.md` | 206 | `superpowers:requesting-code-review` | 同 C8 |
| C12 | `packages/engine/skills/dev/steps/02-code.md` | 224 | `superpowers:receiving-code-review` | 同 C9 |
| C13 | `packages/engine/skills/dev/steps/02-code.md` | 230 | `superpowers:executing-plans` + `superpowers:dispatching-parallel-agents` | `prompts/executing-plans/SKILL.md` + `prompts/dispatching-parallel-agents/SKILL.md` |
| C14 | `packages/engine/skills/dev/steps/02-code.md` | 238 | `superpowers:dispatching-parallel-agents` | 同 C13 |
| C15 | `packages/engine/skills/dev/steps/02-code.md` | 261 | `superpowers:verification-before-completion` | 同 C7 后半 |
| C16 | `packages/engine/skills/dev/steps/01-spec.md` | 11 | `superpowers:brainstorming` + `writing-plans`（描述 changelog 中的引用） | 同 C5 |
| C17 | `packages/engine/skills/dev/steps/01-spec.md` | 87 | `superpowers:brainstorming` + `superpowers:writing-plans` | 同 C5 |
| C18 | `packages/engine/skills/dev/steps/01-spec.md` | 192 | `superpowers:executing-plans` | 同 C13 前半 |
| C19 | `packages/engine/skills/dev/steps/04-ship.md` | 6 | `superpowers:finishing-a-development-branch`（changelog 引用） | `prompts/finishing-a-development-branch/SKILL.md` |
| C20 | `packages/engine/skills/dev/steps/04-ship.md` | 119 | `superpowers:finishing-a-development-branch` | 同 C19 |
| C21 | `packages/engine/skills/dev/steps/00.5-enrich.md` | 45 | `superpowers:brainstorming` | 同 C5 前半 |

### C.3 绝对路径硬编码（P0，CI / 其他 agent 必定失败）

| # | 文件 | 行号 | 当前内容 | 建议 |
|---|------|------|---------|------|
| C22 | `packages/engine/skills/dev/steps/02-code.md` | 493 | ``Source: `~/.claude-account3/plugins/cache/superpowers-marketplace/superpowers/5.0.7/skills/systematic-debugging/root-cause-tracing.md` `` | 硬编码了 account3 绝对路径，在其他账号或 CI 上 100% 不存在。改为本地化副本 `packages/engine/skills/dev/prompts/systematic-debugging/root-cause-tracing.md`（Phase 2 模式分析、Stack Trace 插桩内容既然"逐字搬自"，就直接搬到本地），或只保留说明性链接并把内容完全内嵌。 |

### C.4 汇总

- **引用 C1~C22** 可合并成一次 PR：把 superpowers 5.0.7 的 14 个 skill 目录下被引用的文件（约 20 个 .md）以及 `systematic-debugging/root-cause-tracing.md` 整体 copy 到 `packages/engine/skills/dev/prompts/`，然后批量替换引用字符串。
- 来源缓存下实际存在的相关文件清单（基于扫描确认）：
  - `brainstorming/{SKILL.md, spec-document-reviewer-prompt.md, visual-companion.md, scripts/}`
  - `dispatching-parallel-agents/SKILL.md`
  - `executing-plans/SKILL.md`
  - `finishing-a-development-branch/SKILL.md`
  - `receiving-code-review/SKILL.md`
  - `requesting-code-review/{SKILL.md, code-reviewer.md}`
  - `subagent-driven-development/{SKILL.md, implementer-prompt.md, spec-reviewer-prompt.md, code-quality-reviewer-prompt.md}`
  - `systematic-debugging/{SKILL.md, condition-based-waiting.md, condition-based-waiting-example.ts, defense-in-depth.md, find-polluter.sh, root-cause-tracing.md, CREATION-LOG.md, test-*.md}`
  - `test-driven-development/{SKILL.md, testing-anti-patterns.md}`
  - `verification-before-completion/SKILL.md`
  - `writing-plans/{SKILL.md, plan-document-reviewer-prompt.md}`

---

## D. regression-contract.yaml 空壳检查

**实测结果**：不是空壳，反而是"填满且活跃"的状态。

| 字段 | 行号 | 实测值 | 结论 |
|------|------|--------|------|
| `version` | 31 | `14.17.4` | ✅ 与 package.json 一致 |
| `updated` | 32 | `2026-04-15` | ✅ 有效 |
| `hooks` | 37 起 | 有多个条目（H1/H2/H3/...） | ✅ 非空 |
| `skills` | 3013 起 | 有 S1-006/S1-007... | ✅ 非空 |
| `golden_paths` | 2603 起 | GP-001、GP-002... 已定义（含 rcis + steps） | ✅ 非空 |
| `core` | — | **未定义此 key** | 不是 `[]`，而是根本没声明 |
| 总行数 | — | 3236 | — |

**D.1 `core` 字段状态**: 整文件 grep `^core:` 无匹配。当前顶级 key 只有 `hooks:` / `skills:` / `golden_paths:`（以及头部 `version` / `updated`）。

**D.2 建议**: 若对齐契约要求 `core` 字段存在，那应在 `hooks:` 之前新增：
```yaml
core:
  # 仅放 Engine 自身核心回归，不含 hooks/skills/golden_paths
  - id: CORE-001
    name: "engine 入口 src/index.ts 可加载"
    test: "tests/src/index.test.ts"   # 若有
```
否则可修订对齐契约文字，把 `core` 要求改为"允许省略，由 `golden_paths` 覆盖"。

**D.3 与 `check-version-sync.sh` 的关系**: 由于 `regression-contract.yaml` 的 version（14.17.4）已与 package.json 同步，不需要加 `required_empty: false`。

---

## E. Stage 文件内部矛盾 / 设计漂移

### E.1 `02-code.md` L230-241：systematic-debugging 被"架空"

| 位置 | 引用原文 |
|------|---------|
| `packages/engine/skills/dev/steps/02-code.md:232` | "原 v1 设计'第 3 次直接派 systematic-debugging'与 Superpowers 原意不符——官方 `systematic-debugging` skill 期望'人类已识别失败的尝试'，不适合自动化底层诊断。v2 改为第 3 次派 `dispatching-parallel-agents`" |
| `packages/engine/skills/dev/steps/02-code.md:239` | "diagnostic subagent 并行调查（**不是 systematic-debugging**）" |

**与其他文件的冲突**：
- `02-code.md:335-339`（§"Implementer 必须遵守的 Superpowers 纪律 v9.4.0"）明确"对齐官方 Superpowers 5.0.7 `systematic-debugging`" — 仍声称在用 systematic-debugging
- `02-code.md:441、491`（Phase 2 Pattern Analysis / Stack Trace 插桩）"逐字搬自 systematic-debugging/SKILL.md L122-150 / root-cause-tracing.md L66-106" — 实际内容来源是 systematic-debugging
- `autonomous-research-proxy.md:36`（Tier 2 表格） "systematic-debugging | '3+ fix 失败 -> discuss with human' | 派 dispatching-parallel-agents 独立分析" — 与 02-code.md:238 一致
- `autonomous-research-proxy.md:142` "F4 改：BLOCKED 第 3 次派 dispatching-parallel-agents（不再派 systematic-debugging）" — 与 02-code.md:238 一致
- `autonomous-research-proxy.md:160` 表格："systematic-debugging | ✓ | ✓ | 调用时机 F4 重新设计" — 仍声称"有用"

**结论**: systematic-debugging 既被声称"架空"（BLOCKED 升级链不用），又被声称"对齐"（Implementer prompt 纪律仍然引用其方法论）。**这不是实质冲突**（前者讲的是"失败升级派遣路径"，后者讲的是"方法论内嵌"），但读者容易误解。

**建议**: 在 `02-code.md:230` 附近加一句话澄清——"注意：systematic-debugging 作为**方法论**仍被本 skill 内嵌使用（§Phase 2 / Stack Trace 插桩），仅仅在 BLOCKED 升级链中被替换为 dispatching-parallel-agents"。优先级 P2（文档澄清，非硬违规）。

### E.2 `fetch-task-prd.sh` 与 `devgate-fake-test-detection.test.cjs` 的逻辑冲突

- `fetch-task-prd.sh:331, 356, 358, 363` 生成 `Test: manual:TODO` 行
- `tests/devgate-fake-test-detection.test.cjs:40-42` 检测到 TODO 即报 `valid: false, reason: "禁止使用 TODO 占位符..."`

**结论**: /dev 模板生成器生成的 DoD 一开箱就会被自己的 devgate 拒绝。P0 必修（已作为 B1~B4 列出）。

### E.3 版本号口径矛盾

- `SKILL.md` frontmatter: `version: 7.2.0`
- `SKILL.md` changelog 用 `7.2.0 / 7.1.0 / 7.0.0`
- 但 `02-code.md` 的 changelog 用 Engine 主版本 `9.5.0 / 9.4.0 / ...`，且 `SKILL.md:133` 还出现 `v14.14.0` 引用

三个口径并存：skill 内部版本（7.x）、skill 里另一段引用的 Engine 版本（v14.14.0）、step 文件自己的小版本（9.x）。P2。

---

## F. SKILL.md frontmatter 版本号（与 A4 同一问题，单列展开）

| 项目 | 值 |
|------|----|
| 文件 | `packages/engine/skills/dev/SKILL.md` |
| 行号 | 3 |
| 当前 version | `7.2.0` |
| 期望 version | `14.17.4`（与 Engine 全局对齐） |
| 当前 updated | `2026-04-15` |
| changelog 现状 | 3 条（7.2.0 / 7.1.0 / 7.0.0） |

**修复草案**：
```yaml
---
name: dev
version: 14.17.4
updated: 2026-04-18
description: 统一开发工作流（4-Stage Pipeline）...
trigger: /dev, --task-id <id>, --autonomous
changelog:
  - 14.17.4: 与 Engine 版本同步；前身 skill 内部版本 7.2.0
  - 7.2.0: autonomous_mode 强制加载 autonomous-research-proxy
  - 7.1.0: Step 0.5 PRD Enrich 前置层
  - 7.0.0: Superpowers 融入三角色架构
---
```

---

## 汇总

| 类别 | 数量 | P0（必修） | P1（建议修） | P2（记录） |
|------|------|-----------|------------|-----------|
| A. 版本号不同步 | 1 | 1 (A4) | 0 | 0 |
| B. TODO 占位符 | 4 | 4 (B1-B4) | 0 | 0 |
| C. 悬空引用 | 22 | 1 (C22 硬编码绝对路径) | 21 (C1-C21 superpowers: 引用) | 0 |
| D. regression-contract.yaml | 1 | 0 | 1 (D.1 core 字段缺失) | 0 |
| E. 设计矛盾 | 3 | 1 (E.2，与 B 重叠) | 0 | 2 (E.1, E.3) |
| F. SKILL.md frontmatter | 1 | 与 A4 合并 | — | — |
| **总计** | **31 条** | **6 条 P0** | **22 条 P1** | **3 条 P2** |

**修复总工作量估计**: **M**（中等）

拆解：
- P0 占位符 4 条 + 硬编码路径 1 条 + A4 版本号：一次小 PR（~30min）
- P1 superpowers 本地化：一次结构性 PR，涉及新增 `prompts/` 目录 + 约 20 份文件 copy + 批量文本替换（~1-2h）
- P2 设计澄清：半小时内的文档微调

**建议 PR 顺序**：
1. **PR-1（最小风险）**: A4 + B1-B4 + C22 — 清占位符和硬路径
2. **PR-2（结构改造）**: C1-C21 — 本地化 superpowers 副本 + 批量改引用
3. **PR-3（可选）**: D.1 + E.1 + E.3 — 文档与契约收尾

---

## 附：审计方法论

- 所有版本号通过 `Read` 工具逐个比对，未用 grep 间接判断
- TODO/FIXME 用 `Grep` 全量扫描 `packages/engine/` 后，手工剔除假阳性（注释提到 TODO 但非占位的都剔除）
- 悬空引用用正则 `superpowers:[\w-]+/[\w-]+\.md` 和 `superpowers:` 两级扫描，交叉核对本地 `~/.claude-account1/plugins/cache/superpowers-marketplace/superpowers/5.0.7/skills/` 目录实际存在的文件
- regression-contract.yaml 用 `Grep ^core:|^hooks:|^skills:|^golden_paths:` 确认顶级 key，再 Read 关键片段
- E 类矛盾通过 Read 原文上下文对照 autonomous-research-proxy.md 的 Tier 表得出
