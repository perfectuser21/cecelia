# Harness v5 设计：DoD × TDD × Superpowers 融合

**日期**: 2026-04-20
**状态**: DESIGN（待 writing-plans 阶段展开为实施计划）
**目标**: 解决 DoD 假测试污染 + Generator 不走 TDD + Superpowers 未融入 Harness 三个问题
**基于**: Harness v4.3 现状
**涉及角色**: harness-contract-proposer / harness-contract-reviewer / harness-generator + 4 个 superpowers skill + CI 硬校验

---

## 1. 背景与问题

### 1.1 现状

Harness v4.3 的三层架构：

```
Planner (PRD)
    ↓
Proposer → contract-draft.md (功能描述 + node -e 字符串检查命令)
    ↓ [GAN 对抗：挑战"命令能否被蒙"]
Reviewer → sprint-contract.md APPROVED
    ↓
Generator（照合同写代码，勾 [x]，push）
    ↓
CI（跑 DoD 里的 node -e 命令看 exit code）
```

### 1.2 发现的三个核心问题

**问题 1：DoD 是假测试**

抽样 `sprints/harness-self-check-v2/contract-dod-ws1.md`，Test 字段形如：

```js
node -e "const c=require('fs').readFileSync('...contract-draft.md','utf8');
         if(fb.length<4)throw new Error('FAIL:Feature='+fb.length);..."
```

这是**字符串/正则匹配 artifact**，被标成了 `[BEHAVIOR]`。本质是"文件里有没有这段文字"，不是"功能运行起来对不对"。[BEHAVIOR] 被写成 [ARTIFACT]，两者边界模糊。

**问题 2：Reviewer mutation 机制打错地方**

`harness-contract-reviewer` v4.4 有 Triple 分析（can_bypass + proof-of-falsification），覆盖率 80%。机制健康，但它挑战的是"命令能否被蒙"，不是"测试文件能否被蒙"。命令本身就是 `grep`/`readFileSync` 级的，再怎么挑战也打不到真正的行为层。

**问题 3：Generator 完全不走 TDD**

v4.3 Generator 是"读合同 → 写 DoD.md → 写代码 → 勾 [x] → push"。没有"先写测试文件 → 看红 → 写实现 → 看绿"的 git commit 顺序，CI 无法验证测试先于实现存在。Anthropic 官方 `superpowers:test-driven-development` 的铁律「NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST」完全没接入。

### 1.3 官方 Harness 哲学对齐

Anthropic 官方 Harness 方法论强调「**可机器验证的合同 + 对抗**」，核心词是 contract / verification loop，不强制 TDD。但 TDD 是实现"合同可机器验证"的最强形式。本设计让 TDD 成为 Harness 的一等公民。

**GAN 对抗轮次无上限**（见 memory `harness-gan-design.md`）——Reviewer 必须 very picky，不设 MAX_GAN_ROUNDS，直到 Proposer 写出真能抓假实现的测试。

---

## 2. 关键决策（已经与主理人对齐）

| 项 | 选择 | 理由 |
|---|---|---|
| TDD 硬度 | **硬 TDD** | 两次 commit（测试先于实现）+ CI git log 强校验 |
| 谁写测试 | **Proposer 写完整 `.test.ts`** | 让测试代码进入 GAN 对抗，Reviewer 做真正的 mutation testing |
| Superpowers 集合 | **4 个 superpowers** | test-driven-development / verification-before-completion / systematic-debugging / requesting-code-review |
| 不使用 | **不用 code-review-gate** | simplify 功能已被 TDD 的 "Minimal + Refactor" 覆盖，requesting-code-review 里 subagent 也会 flag 冗余 |
| 老 sprint | **归档到 `sprints/archive/`** | 历史实验痕迹，不影响新流程 |
| 对抗强度 | **无上限 + very picky** | 不加安全阀，不设轮数上限，Reviewer 默认 REVISION 除非证据充分 |
| 实施节奏 | **分 3 个 Sprint 串行** | 风险分散、向前兼容 |

---

## 3. 改造后架构（v5.0）

```
Planner (PRD) ——— 不变
    ↓
Proposer → 合同产物升级为 3 份：
           ├─ sprint-prd.md        (功能描述，不变)
           ├─ contract-dod-ws{N}.md (只剩 [ARTIFACT] 条目)
           └─ tests/ws{N}/*.test.ts (真实失败测试代码，NEW)
    ↓ [GAN 对抗：Reviewer mutation 挑战测试代码本身 — 能否写假实现让测试绿但行为错；无上限]
Reviewer → APPROVED（测试文件也进 contract branch）
    ↓
Generator × Superpowers 融合：
  ├─ commit 1: 测试文件（从合同原样复制，Red）
  ├─ [superpowers:test-driven-development] 验证 Red
  ├─ commit 2: 实现代码（Green）
  ├─ [superpowers:verification-before-completion] push 前跑测试贴证据
  ├─ [superpowers:requesting-code-review] 调 subagent review diff
  ├─ push + PR
  └─ CI 失败 → [superpowers:systematic-debugging]
    ↓
CI 硬校验（NEW）：
  ├─ git log 顺序：测试 commit 在实现 commit 之前
  ├─ 每个 [BEHAVIOR] DoD 条目必须指向 tests/*.test.ts（非 node -e）
  ├─ 测试文件必须真实通过（npm test）
  └─ DoD 完整性（ARTIFACT / BEHAVIOR 标签与 Test 字段匹配）
```

**三个核心转变**：

1. **合同产物加了"真测试代码"**，不只是"描述 + 验证命令"
2. **Generator 走 TDD 纪律**，Red-Green 顺序被 git log 强校验
3. **[BEHAVIOR] 的 Test 字段只接受 `tests/*.test.ts`**，禁止 `node -e` 字符串检查（那个留给 [ARTIFACT]）

---

## 4. DoD 新结构规范（合同单一真相）

### 4.1 DoD 分家规则

| 类型 | 装什么 | 住哪 | Test 字段允许的形式 |
|---|---|---|---|
| **[ARTIFACT]** | 静态产物（文件/内容/配置/文档） | `contract-dod-ws{N}.md` | `node -e "fs.accessSync(...)"` / `node -e "readFileSync + 正则"` / `grep -c` / `test -f` / `bash` |
| **[BEHAVIOR]** | 运行时行为（API 响应/函数返回/错误处理） | `tests/ws{N}/*.test.ts` 的 `it()` 块 | 只允许 vitest 真测试（禁止 `node -e` 字符串） |

### 4.2 分家决策树（Proposer 写合同时）

```
Q: 这个条目能不能只靠"检查文件内容或结构"验证？
  ├─ 能 → [ARTIFACT]
  │   例：Learning 文件存在且含"### 根本原因"
  │       config.json 里 timeout > 0
  │       CI workflow 加了 tdd-order-check job
  │
  └─ 不能，必须跑起来看行为 → [BEHAVIOR] → 写进 .test.ts
      例：重试 3 次后抛错
          API 返回 404 当资源不存在
          并发写入不丢数据
```

### 4.3 `contract-dod-ws{N}.md` 新格式

```markdown
# Contract DoD — Workstream 1: Retry Mechanism

**范围**: 给 fetchWithRetry() 加重试能力
**大小**: M
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] MAX_RETRIES 常量定义在 packages/brain/src/retry.js
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/retry.js','utf8');if(!/const MAX_RETRIES = \d+/.test(c))process.exit(1)"

- [ ] [ARTIFACT] Learning 文件含"### 根本原因"章节
  Test: node -e "const c=require('fs').readFileSync('docs/learnings/cp-xxx.md','utf8');if(!c.includes('### 根本原因'))process.exit(1)"

## BEHAVIOR 索引（实际测试在 tests/ws1/）

见 `sprints/{sprint}/tests/ws1/retry.test.ts`，覆盖：
- retries 3 times on transient failure
- throws after max retries exceeded
- backs off exponentially between retries
```

### 4.4 `tests/ws{N}/*.test.ts` 新格式

```typescript
// sprints/{sprint}/tests/ws1/retry.test.ts
import { describe, it, expect } from 'vitest';
import { fetchWithRetry } from '../../../packages/brain/src/retry.js';

describe('Workstream 1 — Retry Mechanism [BEHAVIOR]', () => {
  it('retries 3 times on transient failure', async () => {
    let attempts = 0;
    const op = () => { attempts++; if (attempts < 3) throw new Error('fail'); return 'ok'; };
    const result = await fetchWithRetry(op);
    expect(result).toBe('ok');
    expect(attempts).toBe(3);
  });

  it('throws after max retries exceeded', async () => {
    const op = () => { throw new Error('always fails'); };
    await expect(fetchWithRetry(op)).rejects.toThrow('always fails');
  });

  it('backs off exponentially between retries', async () => {
    const timestamps: number[] = [];
    const op = () => { timestamps.push(Date.now()); throw new Error('fail'); };
    try { await fetchWithRetry(op); } catch {}
    const gap1 = timestamps[1] - timestamps[0];
    const gap2 = timestamps[2] - timestamps[1];
    expect(gap2).toBeGreaterThan(gap1 * 1.5);
  });
});
```

### 4.5 测试文件硬约束（Proposer 写测试时遵守）

1. **真实 import** 目标模块（不允许 mock 被测对象本身）
2. **具体断言值**（`expect(x).toBe(3)` 而不是 `expect(x).toBeTruthy()`）
3. **测试名描述行为**（`retries 3 times on transient failure`，不是 `test retry works`）
4. **每个 it 只测一件事**（有 "and" 就拆）
5. **Proposer 本地跑过并确认红**（合同里贴 red 输出证据）

### 4.6 测试文件位置

`sprints/{sprint}/tests/ws{N}/*.test.ts` —— 放在 sprint 目录下，不污染主测试树。Generator 实现时**不移动**这些测试文件，就地跑。

vitest config 需要加一行：`test.include: [..., 'sprints/**/tests/**/*.test.ts']`

---

## 5. 实施计划（3 个串行 Sprint）

### 5.1 Sprint A：Proposer / Reviewer 升级（约 2 天）

#### Proposer 改造

读 PRD → 产出 **3 份产物**：

1. **`${SPRINT_DIR}/sprint-prd.md`**（不变）

2. **`${SPRINT_DIR}/contract-dod-ws{N}.md`**
   - 只装 `[ARTIFACT]` 条目
   - Test 字段允许 `node -e` / `grep -c` / `test -f` / `bash`
   - 禁止 `[BEHAVIOR]` 条目

3. **`${SPRINT_DIR}/tests/ws{N}/*.test.ts`**
   - 每个 workstream 一个目录
   - 每个 `[BEHAVIOR]` 对应 1-N 个 `it()` 块
   - 真实 vitest 代码
   - **必须能跑起来但是红的**
   - 在 `contract-draft.md` 里贴 "Red evidence"（npm test 的 FAIL 输出）

**合同 meta 索引表**（在 `contract-draft.md` 末尾）：

```markdown
## Test Contract

| Workstream | Test File | [BEHAVIOR] 对应 | 预期红证据 |
|---|---|---|---|
| WS1 | tests/ws1/retry.test.ts | retries 3 times / backoff linear | `npm test tests/ws1/` → 3 failures |
| WS2 | tests/ws2/api.test.ts | 404 for missing / 422 for invalid | `npm test tests/ws2/` → 2 failures |
```

#### Reviewer 改造

三件事（顺序执行）：

1. **审 DoD 结构**：
   - `contract-dod-ws{N}.md` 不能有 `[BEHAVIOR]` → 否则 REVISION
   - 每个 `[BEHAVIOR]` 必须在 `tests/ws{N}/` 里有对应 `it()` 块

2. **Mutation 挑战测试代码**：
   - 对每个 `it()` 块构造 Triple：`{ test_block, can_bypass, fake_impl, fix }`
   - `can_bypass: Y` 时必须附可运行的假实现代码片段
   - 覆盖率 ≥ 80%（下限，不是目标）

3. **审"红证据"真实性**：
   - Reviewer checkout 测试文件实跑 `npm test tests/ws{N}/`
   - 测试不红 → REVISION

#### Reviewer 心态（非协商）

```
- 默认 REVISION，除非证据充分才 APPROVED
- 对每个 it() 块必须尝试构造 fake_impl，构造不出来才算"测试够严"
- 覆盖率 80% 是下限不是目标
- 宁可多轮 REVISION，绝不因"已经几轮了"就通过
- 没有"轮数上限"，直到 Proposer 写出真能抓假实现的测试
- 对 Proposer 的 Red 证据必须实跑验证
```

#### Sprint A 产出

- 改 `~/.claude/skills/harness-contract-proposer/SKILL.md`（版本 4.4.0 → 5.0.0）
- 改 `~/.claude/skills/harness-contract-reviewer/SKILL.md`（版本 4.4.0 → 5.0.0）
- 新增 vitest 配置指引（若 sprints/ 未被 vitest 覆盖，加 include pattern）

### 5.2 Sprint B：Generator × Superpowers 融合（约 2 天）

#### Generator 新执行流程（Mode 1: harness_generate）

```
Step 0: 解析 TASK_ID / SPRINT_DIR / CONTRACT_BRANCH / WORKSTREAM_INDEX

Step 1: 读合同 + Test 文件
  git fetch origin $CONTRACT_BRANCH
  git show origin/$CONTRACT_BRANCH:$SPRINT_DIR/sprint-contract.md
  git show origin/$CONTRACT_BRANCH:$SPRINT_DIR/contract-dod-ws${WS}.md
  TEST_FILES=$(git ls-tree -r origin/$CONTRACT_BRANCH -- $SPRINT_DIR/tests/ws${WS}/)

Step 2: 创建 cp-* 分支

Step 3: ★ TDD Red 阶段（commit 1 = 测试）
  [Skill: superpowers:test-driven-development]
  git checkout origin/$CONTRACT_BRANCH -- sprints/{sprint}/tests/
  cp sprints/{sprint}/contract-dod-ws${WS}.md DoD.md
  git add sprints/{sprint}/tests/ DoD.md
  git commit -m "test(harness): ws${WS} failing tests (Red)"

  npm test sprints/{sprint}/tests/ > /tmp/red-evidence.txt 2>&1 || true
  grep -c "FAIL\|✗" /tmp/red-evidence.txt

Step 4: ★ TDD Green 阶段（commit 2 = 实现）
  # 逐个 [BEHAVIOR] 对应的 it() 写实现；写一个跑一次看绿
  # ARTIFACT 条目并行完成（Learning / 配置），进同一个 commit 2

  git add <实现文件> docs/learnings/...
  git commit -m "feat(harness): ws${WS} implementation (Green)"

Step 5: ★ Verification 阶段
  [Skill: superpowers:verification-before-completion]
  npm test > /tmp/green-evidence.txt 2>&1
  # 证据贴进 PR body 的 "Test Evidence" section

Step 6: ★ Code Review 阶段
  [Skill: superpowers:requesting-code-review]
  # subagent 返回 issues list，Generator 按严重度处理

Step 7: Push + PR
  git push origin HEAD
  gh pr create ...
  # PR body 含：Test Evidence（红→绿）+ Review Summary + Learning

Step 8: 输出 verdict JSON（不变）
  {"verdict": "DONE", "pr_url": "..."}
```

#### Mode 2（harness_fix，CI 失败修复）

```
读 payload.ci_fail_context
  ↓
[Skill: superpowers:systematic-debugging]
  - 先读红的测试输出，定位失败原因
  - 写一个复现测试（若现有测试不足以定位）
  - 按 Red-Green-Refactor 修
  ↓
commit + push 到原 PR 分支
```

#### 保留的"严禁事项"（CONTRACT IS LAW）

1. 禁止自写 sprint-contract.md
2. 禁止加合同外的测试（测试文件也是合同的一部分）
3. 禁止修改从合同复制的测试代码（只能改实现让它绿）
4. 禁止在 main 分支操作
5. 禁止 `find /Users` 广泛搜索

#### Sprint B 产出

- 改 `~/.claude/skills/harness-generator/SKILL.md`（版本 4.3.0 → 5.0.0）
- `sprint-generator` v3.1 标记 deprecated（委托 /dev 与新方向冲突）

### 5.3 Sprint C：CI 硬校验 + 清理（约 1 天）

#### 新增 CI 检查项

**检查 1：DoD 结构纯度**

```yaml
job: dod-structure-purity
  - contract-dod-ws*.md 只允许 [ARTIFACT]，禁止 [BEHAVIOR]
  - 每个 [ARTIFACT] Test 字段必须是白名单：node -e / grep -c / test -f / bash
  - 违反 → exit 1，提示"BEHAVIOR 请迁到 tests/ws{N}/*.test.ts"
```

实现：改 `packages/engine/scripts/devgate/check-dod-mapping.cjs`。

**检查 2：测试文件存在性（BEHAVIOR 覆盖）**

```yaml
job: test-coverage-for-behavior
  - 读合同 "## Test Contract" 索引表
  - 每行声明的 tests/ws{N}/*.test.ts 必须在 PR diff 中存在
  - 每个 [BEHAVIOR] 描述必须在某 .test.ts 里有对应 it() 块（名称匹配）
```

实现：新写 `packages/engine/scripts/devgate/check-test-coverage.cjs`。

**检查 3：Red-before-Green commit 顺序（TDD 铁律硬化）**

```yaml
job: tdd-commit-order
  - git log PR 分支 vs main
  - commit 1 touch 的文件必须全是 tests/ws*/*.test.ts
  - commit 2+ touch 的文件必须包含实现代码（不能只有测试）
  - commit 1 message 必须含 "Red" 或 "(Red)"
  - 实现 commit message 必须含 "Green" 或 "(Green)"
```

实现：新写 `.github/workflows/tdd-order-check.yml`（~20 行 bash）。

**检查 4：测试实际通过（不只是存在）**

```yaml
job: tests-actually-pass
  - npm test sprints/**/tests/ws*/
  - 不允许 skip / todo / xit
  - 覆盖 ≥ 当前 PR 新增 [BEHAVIOR] 条目数
```

实现：workspace-ci.yml 加 assertion：PR diff 引入的所有 `it()` 块必须 PASS。

**检查 5：老格式兼容警告（软）**

```yaml
job: legacy-dod-warning (非阻塞)
  - 扫 sprints/ 下新建的 contract-dod-ws*.md 若还用 node -e readFileSync 风格且标 [BEHAVIOR]
  - 只打 warning，不 fail
```

#### 老 sprint 清理

**一次性归档**（单独 PR，不和 CI 改动混）：

```bash
mkdir -p sprints/archive/
git mv sprints/{ai-native-dev-redesign,alignment-table-gen,callback-queue-persistence,\
e2e-v3-04082126,engine-slimdown-phase4,harness-contract-fix-v1,harness-self-check-v2,\
harness-self-optimize-v1,harness-v5-e2e-test2,harness-v6-hardening,l2-dynamic-contract,\
phase1-round2,phase1-unification,phase3-rollback-l2,run-20260407-2353,sprint-1,\
sprint-2,superpowers-alignment} sprints/archive/

# 散落根目录的 md 归档
mkdir -p sprints/archive/root-leftovers/
git mv sprints/{sprint-prd.md,sprint-contract.md,sprint-report.md,\
eval-round-1.md,ci-coverage-assessment.md} sprints/archive/root-leftovers/
```

`sprints/archive/**` 从新 CI 检查中排除。

#### Sprint C 产出

- 3 个新 CI check（DoD 纯度 / 测试覆盖 / TDD commit 顺序）
- 1 个现有脚本升级（check-dod-mapping.cjs 加纯度扫描）
- 老 sprint 归档 PR（单独 1 个 PR）

---

## 6. 风险、回滚、度量

### 6.1 风险与缓解

| 风险 | 可能后果 | 缓解 |
|---|---|---|
| **Proposer 的"Red 证据"作假** | 测试没跑过，装红 | Reviewer 必须 checkout 实跑 `npm test`，不红就 REVISION。Reviewer 默认 picky，宁可错杀 |
| **Generator 在 commit 1 和 commit 2 中间偷偷改测试** | 测试被改弱 | CI 硬检查：测试文件 diff 在 commit 2+ 里为空 |
| **Generator 过度拟合最窄实现** | 边界真实缺陷 | 上游 Reviewer 的 mutation 挑战负责把测试审严（测试够严则过度拟合不可能）|
| **CI 新 check 误杀** | 阻塞正常 PR | `continue-on-error: true` 上线 1 周观察，再切硬门禁 |
| **老 sprint 归档破坏隐藏依赖** | CI 找不到文件 | 归档 PR 只动 `sprints/`，绿了才合 |

**不设**：GAN 轮数上限 / Proposer 写不出时的降级 / 其他弱化对抗强度的安全阀。

### 6.2 回滚方案（按 Sprint 粒度）

- **Sprint A 坏了**：revert SKILL.md 到 4.4.0，Sprint B/C 推迟
- **Sprint B 坏了**：revert SKILL.md 到 4.3.0，Sprint A 产出的 `.test.ts` 合同老 generator 会忽略（不会坏）
- **Sprint C 某 check 误杀**：该 check 在 `continue-on-error` 保护期内不会阻塞，关掉重调

### 6.3 成功度量

| 指标 | 改造前（baseline） | 改造后目标 |
|---|---|---|
| **DoD 里 node -e 字符串检查占比** | 估计 >70% | [ARTIFACT] <100% / [BEHAVIOR] 0%（分家彻底）|
| **PR 里含真实 `.test.ts` 新增** | 估计 <30% | ≥95%（feat 类 PR）|
| **Evaluator/CI 实际能抓出的假实现** | 依赖提示词 | 依赖测试代码 + git log 顺序，靠机器校验 |
| **GAN 对抗平均轮次** | 1-2 轮 | 2-3 轮（挑战深，更多 REVISION）|
| **Generator 一次成功率** | 60-70% | 持平或略高 |

### 6.4 范围外（这次不做）

- 不改 `sprint-planner` / `harness-planner`
- 不改 `harness-report`
- 不改 Brain `execution.js`
- 不改 `/dev` 主接力链（它本来就调完整 superpowers）

---

## 7. Skill 版本变化清单

| Skill | 当前版本 | 新版本 | 说明 |
|---|---|---|---|
| `harness-contract-proposer` | 4.4.0 | 5.0.0 | 产出 3 份产物（含 .test.ts），附 Red evidence |
| `harness-contract-reviewer` | 4.4.0 | 5.0.0 | mutation 挑战测试代码，实跑红证据 |
| `harness-generator` | 4.3.0 | 5.0.0 | 调 4 个 superpowers，Red-Green commit 顺序 |
| `sprint-generator` | 3.1.0 | deprecated | 委托 /dev 与新方向冲突 |
| `sprint-contract-proposer` / `sprint-contract-reviewer` / `sprint-evaluator` | v3.1 系 | deprecated | 老 Harness v3 流程下线 |

---

## 8. 实施顺序

```
Sprint A（Proposer + Reviewer）
    ↓ APPROVED 后上线
Sprint B（Generator × Superpowers）
    ↓ APPROVED 后上线
Sprint C（CI 硬校验）
    ↓ APPROVED 后上线
老 sprint 归档 PR
```

每个 Sprint 独立走 `/dev` 流程（PRD → Spec → 代码 → Review → PR → Merge），上线后再启动下一个。

---

## 9. 下一步

本 spec 经主理人确认后，进入 `superpowers:writing-plans` 阶段，把 Sprint A 展开为详细实施计划（逐文件 / 逐接口 / 逐测试的 step-by-step plan）。Sprint B、C 在 Sprint A 上线后分别展开计划。
