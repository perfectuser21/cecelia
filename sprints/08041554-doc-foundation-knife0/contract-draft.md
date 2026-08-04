# Contract Draft: 刀0 — 文档正本落地 + 三方对账闸 + docs 目录登记闸

TASK_ID: f1cd8a2e-476e-4827-a26c-5e44293d018b
SPRINT_DIR: sprints/08041554-doc-foundation-knife0
生成时间: 2026-08-04
轮次: 第2轮（修复 R1 格式硬检查）

---

## 一、Contract 状态：PROPOSED（待 Reviewer 审核）

---

## 二、技术断言（PRD → 可验证断言翻译）

### ASSERT-1：正本文件存在且含双 marker

**来源 FR**：FR-1（I-1、I-2）

**可验证断言**：
```
文件 packages/workflows/KERNEL_CONTEXT.md 存在
AND grep -q '<!-- HARD_RULES:BEGIN -->' packages/workflows/KERNEL_CONTEXT.md → exit 0
AND grep -q '<!-- HARD_RULES:END -->' packages/workflows/KERNEL_CONTEXT.md → exit 0
```

**失败标准**：文件不存在 OR 任一 marker 缺失 → FAIL

---

### ASSERT-2：三方对账脚本已升级为三方（代码层验证）

**来源 FR**：FR-2（I-3）

**可验证断言**：
```
grep -q 'packages/workflows/KERNEL_CONTEXT.md' scripts/check-agents-rules-sync.sh → exit 0
```

**失败标准**：脚本内容不含正本路径引用 → FAIL（证明未升级为三方）

---

### ASSERT-3：docs 目录登记 smoke 脚本存在且可执行

**来源 FR**：FR-3（I-4、I-6）

**可验证断言**：
```
test -f scripts/smoke/check-docs-dir-registry-smoke.sh → exit 0
test -x scripts/smoke/check-docs-dir-registry-smoke.sh → exit 0
```

**失败标准**：文件不存在 OR 不可执行 → FAIL

---

### ASSERT-4：基线文件存在且非空

**来源 FR**：FR-4（I-5）

**可验证断言**：
```
test -f docs/current/docs-dir-baseline.txt → exit 0
test -s docs/current/docs-dir-baseline.txt → exit 0   # -s: 非空
```

**失败标准**：文件不存在 OR 文件为空 → FAIL

---

## 三、proven-to-fire 验火断言（FR-6）

### FIRE-1：三方对账闸验火

**步骤**（验收时执行，结果写入 PR body）：
1. `echo ' ' >> packages/workflows/KERNEL_CONTEXT.md`（末尾追加空格，制造差异）
2. `bash scripts/check-agents-rules-sync.sh`
3. 期望输出：含 `❌` 差异行，exit code = 1
4. `git checkout packages/workflows/KERNEL_CONTEXT.md`（还原，不提交）

**可机器验证的断言**：
```bash
echo ' ' >> packages/workflows/KERNEL_CONTEXT.md
bash scripts/check-agents-rules-sync.sh
FIRE_EXIT=$?
git checkout packages/workflows/KERNEL_CONTEXT.md
test $FIRE_EXIT -eq 1   # 必须 exit 1
```

---

### FIRE-2：docs 目录登记闸验火

**步骤**（验收时执行，结果写入 PR body）：
1. `mkdir docs/zzz-firecheck`
2. `bash scripts/smoke/check-docs-dir-registry-smoke.sh`
3. 期望输出：含 `❌ 未登记目录: docs/zzz-firecheck`，exit code = 1
4. `rmdir docs/zzz-firecheck`（还原，不提交）

**可机器验证的断言**：
```bash
mkdir docs/zzz-firecheck
bash scripts/smoke/check-docs-dir-registry-smoke.sh
FIRE_EXIT=$?
rmdir docs/zzz-firecheck
test $FIRE_EXIT -eq 1   # 必须 exit 1
```

---

## 四、NFR 断言

| NFR | 可验证形式 |
|-----|-----------|
| NFR-1 对账脚本 ≤2s | `time bash scripts/check-agents-rules-sync.sh` real < 2s |
| NFR-2 smoke 脚本 ≤3s | `time bash scripts/smoke/check-docs-dir-registry-smoke.sh` real < 3s |
| NFR-3 幂等性 | 连续执行两次，exit code 与 stdout 一致 |
| NFR-4 无外部依赖 | 脚本内容不含 node/python/jq 调用（grep 检查） |

---

## 五、TDD 红绿阶段断言

| 阶段 | commit 内容 | 预期测试结果 |
|------|------------|-------------|
| commit-1（红） | 仅提交 doc-foundation-contract.test.sh | PASS=0 FAIL=4 |
| commit-2（绿） | 提交全部实现（FR-1~FR-4） | PASS=4 FAIL=0 |

---

## Test Contract

| BEHAVIOR | Test File | it() 名称 |
|----------|-----------|-----------|
| ASSERT-1 正本文件存在且含双 marker | `tests/doc-foundation-contract.test.sh` | ASSERT-1: KERNEL_CONTEXT.md 存在且含双 marker |
| ASSERT-2 三方对账脚本升级为三方 | `tests/doc-foundation-contract.test.sh` | ASSERT-2: check-agents-rules-sync.sh 引用正本路径 |
| ASSERT-3 docs 目录登记 smoke 脚本存在且可执行 | `tests/doc-foundation-contract.test.sh` | ASSERT-3: check-docs-dir-registry-smoke.sh 存在且可执行 |
| ASSERT-4 基线文件存在且非空 | `tests/doc-foundation-contract.test.sh` | ASSERT-4: docs-dir-baseline.txt 存在且非空 |

---

## 六、不在本 Contract 范围内

- 僵尸文档清理（刀0.5）
- Notion 同步链（刀1）
- 品牌文件 HARD_RULES 区块内容修改
- Kernel/orchestrator 代码变更

---

## 七、产物清单

| 产物 | 路径 | 状态 |
|------|------|------|
| 约束正本 | `packages/workflows/KERNEL_CONTEXT.md` | 待创建（FR-1） |
| 三方对账脚本（升级） | `scripts/check-agents-rules-sync.sh` | 待升级（FR-2） |
| 目录登记 smoke 脚本 | `scripts/smoke/check-docs-dir-registry-smoke.sh` | 待创建（FR-3） |
| 基线文件 | `docs/current/docs-dir-baseline.txt` | 待创建（FR-4） |
| 契约测试 | `packages/engine/tests/integrity/doc-foundation-contract.test.sh` | 待创建（FR-5） |

---

## E2E 验收

**判定为 PASS 的充要条件**（全部满足方可合并）：

1. `bash packages/engine/tests/integrity/doc-foundation-contract.test.sh` 输出 `PASS=4 FAIL=0`，exit 0
2. `bash scripts/check-agents-rules-sync.sh` 输出 `✅ 三方（正本/AGENTS/CLAUDE）硬规则摘要一致`，exit 0
3. `bash scripts/smoke/check-docs-dir-registry-smoke.sh` exit 0（所有 docs/ 一级子目录已登记）
4. PR body 含 FIRE-1 和 FIRE-2 的验火截图/输出（均显示 exit 1）

**任一不满足 → 判定为 FAIL，不合并**
