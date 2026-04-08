# 合同审查反馈（第 4 轮）

**审查者**: Evaluator
**审查轮次**: Round 4
**判决**: REVISION

---

## 必须修改

### 1. [命令工具错误] Feature D Command 2 — `--testPathPattern` 是 Jest flag，Brain 用 vitest

**问题**：

```bash
bash -c 'set -o pipefail; cd packages/brain && npm test -- --testPathPattern="harness-sprint-loop|contract-max-rounds" 2>&1 | tail -30'
```

`packages/brain/package.json` 的 test 脚本是：
```bash
bash -c 'NODE_OPTIONS="--max-old-space-size=3072" npx vitest run 2>&1 | tee /tmp/brain-vitest-out.txt; ...'
```

Brain 使用 **vitest 1.6.x**（非 Jest）。`--testPathPattern` 是 Jest 专属 CLI flag，有两种失效场景：

**场景 A（静默忽略）**：`npm test -- --testPathPattern=...` 向 bash -c 脚本传递额外参数时，args 被传给 shell 而非 vitest，flag 被忽略，实际运行**全部测试**。Generator 若只写了一个空跳过的 MAX_ROUNDS 测试，全套老测试照样通过，命令返回 exit 0，Feature D 无效验证。

**场景 B（报错）**：若 vitest 遇到未知 `--testPathPattern` flag 直接抛 "Unknown option"，命令**永远** exit non-zero，即使实现完全正确，Evaluator 也会判 FAIL，合同无法被通过。

**修复方式**：改用 vitest 位置参数语法作为文件模式过滤：

```bash
bash -c 'set -o pipefail; cd packages/brain && NODE_OPTIONS="--max-old-space-size=3072" npx vitest run harness-sprint-loop contract-max-rounds 2>&1 | tail -30'
```

---

## 可选改进

### 2. [弱验证] Feature A Command 2 — `[>]=?` 允许 `>` 与 `>=`，无法检测 off-by-one

当前正则：
```js
/^[^/]*nextRound\s*[>]=?\s*MAX_CONTRACT_PROPOSE_ROUNDS/
```

`[>]=?` 同时匹配 `>` 和 `>=`。若实现使用 `propose_round > MAX`（严格大于），则 round 5 仍会创建第 6 轮 propose，破坏 MAX=5 上限保护，但此命令 PASS。

Feature D 的单元测试（round=5 + REVISION → 不创建 sprint_contract_propose）会间接捕捉此 bug，但 Feature D Command 2 目前因上述工具问题需要修复，两者相互依赖。

建议改为只接受 `>=`：
```js
/^[^/]*(?:nextRound|propose_round)\s*>=\s*MAX_CONTRACT_PROPOSE_ROUNDS/
```

### 3. [未验证行为] Feature B — "push 失败视为软错误"无验证命令

合同声明 "push 失败视为软错误，不阻塞任务回调"，但验证命令只检查 SKILL.md 文件内容，未验证运行时的容错行为。此项不影响 APPROVED，但实现中应注意。
