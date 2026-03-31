---
name: spec-review
version: 1.6.0
model: claude-sonnet-4-6
created: 2026-03-20
updated: 2026-03-30
changelog:
  - 1.6.0: 修复 divergence_count=0 处理（exit 2 → FAIL + blocker issue）、添加 reviewer_model 输出字段、补充主 agent 对 FAIL 的自动重试响应说明
  - 1.5.0: divergence 下限检查 — Sprint Contract Gate 完成后，divergence_count = 0 直接 exit 2 要求重跑（Evaluator 未独立思考）
  - 1.4.0: Sprint Contract CI 兼容性约束 — Evaluator 独立方案必须使用 CI 可执行形式（node/curl/tests/），禁止浏览器交互和 UI 操作描述
  - 1.3.0: 新增双向协商机制（Sprint Contract）— subagent 独立生成测试方案后与主 agent 比对，分歧时标记并要求重写
  - 1.2.0: 新增维度F 测试层匹配性检查（unit/integration/e2e，warning级）
  - 1.1.0: 新增维度D DoD Test字段可执行性验证（blocker强制）
  - 1.0.0: 合并 dod_verify + cto_review（单 PR 部分）为统一 Spec 审查 Gate
description: |
  Spec 审查 Gate（Codex Gate 2/4）。合并了 dod_verify（DoD 验证）和 cto_review 的单 PR 审查部分。
  在 /dev Stage 1 (Spec) 完成后、写代码之前触发。
  审查 DoD 测试设计、PRD 对齐度、架构方向、测试命令可执行性。
  给出 PASS / FAIL 裁决。
  触发词：审查 Spec、spec-review、DoD 审查、写代码前检查。
---

> **CRITICAL LANGUAGE RULE: 所有输出必须使用简体中文。**

# Spec-Review — Spec 审查 Gate

**唯一职责**：在 /dev Stage 1 (Spec) 完成后、写代码之前，审查 DoD + 实现方案的质量。

合并了以下两个旧 Skill 的职责：
- `dod_verify`：DoD 测试设计验证
- `cto_review`（单 PR 部分）：架构方向审查

**时机**：/dev Stage 1 完成 -> Spec-Review 审查 -> 通过后才能进入 Stage 2 写代码。

---

## 触发方式

```
/spec-review                             # 审查当前分支的 Spec
/spec-review --task-id <id>              # 指定 Brain 任务
```

### Brain 自动派发

```json
{
  "task_type": "spec_review",
  "task_id": "<uuid>",
  "branch_name": "cp-XXXX-feature",
  "prd_path": "PRD.md",
  "dod_path": "DoD.md"
}
```

---

## 输入

审查以下文件（从当前分支读取）：

| 文件 | 用途 |
|------|------|
| `.task-cp-xxx.md` | Task Card，包含需求 + 成功标准 + DoD |
| `PRD.md` | 需求文档（若有独立 PRD） |
| `.dev-mode` / `.dev-lock` | 开发状态文件，包含 stage 信息 |

---

## 审查维度

### 维度 A：DoD 测试设计合理性

| 检查项 | 通过条件 | 失败信号 |
|--------|----------|----------|
| **test 字段完整** | 每个 DoD 条目有 `test:` 字段 | 缺少 test 字段 |
| **测试有效性** | test 命令能真正验证需求（不是假测试） | `echo "pass"` 或 `grep \| wc -l` 等假测试 |
| **边界覆盖** | 涵盖正常路径 + 异常路径 | 只测 happy path |
| **独立性** | 每个 test 可独立运行 | test 之间有隐藏依赖 |

### 维度 B：DoD 与 PRD 的对齐度

| 检查项 | 通过条件 | 失败信号 |
|--------|----------|----------|
| **成功标准覆盖** | PRD 中每个成功标准在 DoD 中有对应条目 | 成功标准被遗漏 |
| **场景完整** | PRD 描述的所有场景都有 DoD 覆盖 | 有场景无人测试 |
| **非功能需求** | 性能、安全等非功能需求有 DoD 条目 | 非功能需求被忽略 |

### 维度 C：架构方向

| 检查项 | 通过条件 | 失败信号 |
|--------|----------|----------|
| **方案合理** | 实现方案能达成 PRD 目标 | 方案与目标不匹配 |
| **边界正确** | 改动在正确的 package 内（brain/engine/workflows） | 跨边界（如在 engine 里写 brain 逻辑） |
| **复杂度适当** | 方案复杂度与问题匹配 | 过度工程或过于简陋 |
| **兼容性** | 不破坏现有功能 | 有明显的破坏性变更 |

### 维度 D：Test 字段可执行性验证（强制 blocker）

每条 DoD 条目的 Test 字段必须是真实的行为验证命令，不允许模糊或无意义的测试。

| 检查项 | 严重度 | 说明 |
|--------|--------|------|
| **Test 字段缺失** | blocker | DoD 条目没有 Test 字段（或值为 TODO）|
| **泛化测试命令** | blocker | Test 字段只是 `manual:bash -c "npm test"` 或 `manual:bash -c "cd xxx && npm test"` 这类不验证具体行为的命令 |
| **[BEHAVIOR] 无断言** | blocker | [BEHAVIOR] 条目的 Test 命令没有具体断言（没有 exit code 检查、没有 `[[ "$R" == *xxx* ]]`、没有 `process.exit(1)`）|
| **禁止 grep/ls/echo 作测试** | blocker | Test 命令用 grep/ls/echo 只检查文件存在，不验证实际行为 |

**合格的 Test 字段示例**：
- `manual:node -e "const c=require('fs').readFileSync('path','utf8');if(!c.includes('xxx'))process.exit(1)"` ✅
- `manual:bash -c 'R=$(node script.js 2>/dev/null);[[ "$R" == *expected* ]]'` ✅
- `manual:curl -s localhost:5221/api/health | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));if(d.status!=='ok')process.exit(1)"` ✅
- `tests/some.test.ts` ✅

**不合格的示例**：
- `manual:bash -c "npm test 2>&1 | tail -5"` ❌（不验证具体行为）
- `manual:bash -c "ls -la packages/engine/lib/devloop-check.sh"` ❌（只检查文件存在）
- `TODO` ❌（未填写）

### 维度 E：测试命令可执行性

| 检查项 | 通过条件 | 失败信号 |
|--------|----------|----------|
| **白名单工具** | `manual:` 命令只用 node/npm/curl/bash/psql | 使用了 grep/ls/cat 等非白名单工具 |
| **路径正确** | 引用的文件路径存在或将在实现中创建 | 引用了不存在且不会创建的路径 |
| **退出码明确** | 命令有明确的 exit 0（成功）/ exit 1（失败） | 命令只有输出没有判定 |
| **无 npx vitest** | 不使用 `npx vitest` / `npm test`（CI 无完整依赖） | 使用了 CI 无法执行的命令 |

### 维度 F：测试层匹配性（unit / integration / e2e）

> 验证 DoD Test 命令的测试层级与被测行为是否匹配，避免用错误层级的测试掩盖问题。

| 被测行为类型 | 应匹配的测试层 | 不匹配信号 |
|------------|--------------|-----------|
| **纯函数 / 工具函数 / 解析逻辑** | unit（隔离调用，不依赖外部） | 用 HTTP 请求或 DB 调用来测 |
| **API 端点 / DB 查询 / 多模块联动** | integration（真实 DB 或真实进程） | 仅用 node -e 调用单个函数，绕过 HTTP 层 |
| **完整用户流程 / 跨服务端到端** | e2e（curl + 真实服务运行中） | 只 mock 中间层，不验证真实链路 |
| **文件/配置内容验证** | node -e 读文件断言（任意层均可） | 无限制 |

**评判规则（warning 级，不触发 FAIL）**：

- [BEHAVIOR] 条目声明了 API/DB 行为，但 Test 命令只调用函数而不走 HTTP → warning（建议改为 curl 验证）
- [BEHAVIOR] 条目声明了完整用户流程，但 Test 没有 e2e 路径 → warning（建议补充端到端用例）
- unit 测试验证了跨模块副作用（如 DB 写入、文件生成）→ warning（单元测试边界过宽）

**不触发 warning 的情况**：
- [ARTIFACT] 条目只验证文件内容，用 node -e 读文件 ✅
- [GATE] 条目用 npm test 跑全量 ✅
- [PRESERVE] 条目用最小命令验证关键行为不变 ✅

**blocker 规则**：
- [GATE] 条目测试命令只打印文字，无 exit code 断言 → blocker

---

## 双向协商机制（Sprint Contract）

> **目的**：解决「自我认证」问题——主 agent 自己写 Test 字段后自己审查，存在主观偏差。
> Sprint Contract 要求 Evaluator（spec_review）独立生成测试方案，再与主 agent 的方案比对，
> 只有达成一致才能继续写代码。

### 执行流程

```
对每个 DoD 条目（ARTIFACT/BEHAVIOR/GATE/PRESERVE）：

1. 独立生成测试方案（不看主 agent 的 Test 字段）
   - 根据条目类型和描述，设计最合适的测试命令
   - 遵循测试层规则：ARTIFACT → node 文件断言，BEHAVIOR → curl/API 断言，GATE → e2e

   ⚠️  CI 可执行白名单（强制约束）：
   Evaluator 独立生成的 my_test 只允许以下形式：
     ✅ node -e "..."（Node.js 内联脚本）
     ✅ curl（HTTP 请求验证）
     ✅ tests/*.test.ts（测试文件引用）
   禁止浏览器点击行为和 UI 交互描述，例如：
     ❌ "打开浏览器，点击xxx按钮"
     ❌ "在页面上操作xxx"
     ❌ playwright.click() / puppeteer 操作（除非封装在 tests/ 文件中）
   原因：Evaluator 生成的方案必须与 CI 实际执行的检查完全一致，
         浏览器/UI 描述无法在 CI 中自动执行，导致验证脱节。

2. 比对
   - 读取主 agent 的 Test 字段
   - 判断：双方测试方案是否验证同一件事？
     * 一致（consistent: true）→ 采信主 agent 的 Test 字段，继续
     * 不一致（consistent: false）→ 标记分歧，写入 issues，返回 FAIL

3. 分歧类型
   - 严重分歧（blocker）：主 agent 测试的是另一件事，或是假测试
   - 轻微分歧（warning）：测试层不匹配（如 BEHAVIOR 用了静态文件检查代替 curl）

4. divergence 下限检查（CRITICAL — 所有条目比对完成后执行）
   计算 divergence_count（所有 consistent: false 的条目总数，包含 blocker 和 warning）。

   # 注意：independent_test_plans.length === 0 时等同于 divergence_count == 0（未生成任何独立方案）
   if divergence_count == 0:
     # Evaluator 与主 agent 完全一致 → 可能没有独立思考，结论不可信
     # 处理方式：设置 verdict = "FAIL"，在 issues 中写入 blocker
     set verdict = "FAIL"
     add issue: {
       severity: "blocker",
       dimension: "sprint_contract",
       description: "divergence_count = 0：Evaluator 未发现任何分歧，无法证明进行了真实的独立审查",
       suggestion: "重新运行 spec_review subagent，Evaluator 必须至少有 1 个独立观点（哪怕是 warning 级建议）"
     }
     # ↑ 注意：不再 exit 2，而是正常返回 JSON，verdict=FAIL
     # 主 agent 响应：读取 seal 文件 → 发现 verdict=FAIL → 读取 issues 中的 blocker
     #               → 修复 Task Card Test 字段 → 重新调用 spec_review subagent
     #               （全程自动重试，不需要人工干预，循环直到 PASS）
```

> **主 agent 对 FAIL 的响应**：主 agent 读取 seal 文件 → 发现 verdict = FAIL → 读取 issues → 修复 Task Card Test 字段 → **自动重新调用** spec_review subagent（无需人工干预，循环直到 PASS）。

> **为什么要求 divergence_count >= 1**：
> Sprint Contract 的核心价值是"第二双眼睛"——如果 Evaluator 与主 agent 在每一条 DoD 测试上完全一致，
> 说明 Evaluator 没有提供独立视角，只是简单认同，等同于主 agent 自认证。
> 哪怕是 warning 级别的轻微分歧（如测试层建议）也是有价值的独立观点。
> divergence_count = 0 → verdict=FAIL（含 blocker issue）→ 主 agent 读取 FAIL → 自动重新调用 spec_review subagent。

### 一致性判断标准

| 判定 | 条件 |
|------|------|
| **一致** | 两个方案都能验证同一个 DoD 条目的核心断言，即使命令形式不同 |
| **严重分歧** | 主 agent 方案只验证文件存在，而真实行为未被测试；或主 agent 方案有假测试 |
| **轻微分歧** | 两方案都能验证核心行为，但测试层或测试粒度不同 |

### 输出中的 Sprint Contract 字段

每次审查必须在输出 JSON 中包含 `independent_test_plans` 和 `negotiation_result` 字段（见下方输出格式）。

---

## 裁决规则

### PASS

所有维度通过，或只有 warning 级别的小问题。可以进入 Stage 2 写代码。

**注意**：若 Sprint Contract 比对发现所有分歧均为 warning 级（轻微），仍可 PASS。

### FAIL

以下任一情况为 FAIL：
- DoD 缺少 test 字段（任何一个条目）
- PRD 成功标准未被 DoD 覆盖
- 架构方向有明显问题（跨边界、破坏性变更）
- test 命令使用了非白名单工具
- test 命令是假测试（echo/grep|wc -l）
- Test 字段质量不达标（维度 D 任一 blocker）
- Sprint Contract 比对发现严重分歧（主 agent 测试方案无法验证 DoD 声明的行为）
- Evaluator 自身独立方案（my_test）使用了非 CI 可执行形式（浏览器操作、UI 交互描述）
- **independent_test_plans 为空**（即 independent_test_plans.length === 0）：Evaluator 未真正执行 Sprint Contract，未独立生成任何测试方案，无法证明进行了真实的独立审查

FAIL 时必须返回 Stage 1 修正 Spec，不能进入 Stage 2。

---

## 输出格式（必须 JSON）

```json
{
  "verdict": "PASS | FAIL",
  "independent_test_plans": [
    {
      "dod_item": "DoD 条目描述（前 50 字）",
      "my_test": "我独立设计的测试命令",
      "agent_test": "主 agent 的 Test 字段内容",
      "consistent": true,
      "note": "分歧说明（一致时留空，分歧时说明原因）"
    }
  ],
  "negotiation_result": {
    "consistent_count": 5,
    "divergence_count": 1,
    "blockers_from_divergence": 0,
    "summary": "协商结果一句话总结"
  },
  "issues": [
    {
      "severity": "blocker | warning",
      "dimension": "A | B | C | D | E | F | sprint_contract",
      "description": "具体问题描述",
      "suggestion": "修正建议"
    }
  ],
  "summary": "一句话总结"
}
```

severity 规则：
- `blocker`：必须修正，否则不能进入 Stage 2（导致 verdict=FAIL）
- `warning`：建议修正，不阻塞（verdict 仍可为 PASS）

---

## Brain 回调

审查完成后回调 `/api/brain/execution-callback`：

```bash
curl -s -X POST http://localhost:5221/api/brain/execution-callback \
  -H "Content-Type: application/json" \
  -d "{
    \"task_id\": \"$TASK_ID\",
    \"run_id\": \"$RUN_ID\",
    \"status\": \"AI Done\",
    \"result\": {
      \"verdict\": \"PASS\",
      \"summary\": \"$SUMMARY\"
    }
  }"
```

---

## 核心原则

1. **写代码前拦截**：在 Stage 1 完成后立即审查，避免写了代码再发现方向错
2. **blocker 必须清零**：有 blocker 就不能写代码
3. **具体可操作**：每个 issue 必须有 suggestion，不能只说"不好"
4. **快速审查**：一次审查不超过 3 分钟
