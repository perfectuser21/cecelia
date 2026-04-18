# TDD Artifact 合格范例与反面教材

本文件给 Spec Reviewer 一个具体判官手册：什么样的 red/green log 算合格，什么样的一眼就是反向填充。

---

## 合格示例 ✅

**场景**：给 `packages/engine/lib/capacity-budget.ts` 加一个 `computeWeeklyCap(prs, days)` 函数，返回每周可合并 PR 上限。

### tests/capacity-budget.test.ts（测试文件）

```ts
import { describe, it, expect } from 'vitest';
import { computeWeeklyCap } from '../lib/capacity-budget';

describe('computeWeeklyCap', () => {
  it('returns floor(prs / days * 7) for typical case', () => {
    expect(computeWeeklyCap(21, 14)).toBe(10);
  });
  it('returns 0 when no PRs', () => {
    expect(computeWeeklyCap(0, 7)).toBe(0);
  });
  it('throws on non-positive days', () => {
    expect(() => computeWeeklyCap(5, 0)).toThrow();
  });
});
```

### .tdd-evidence/capacity-budget-red.log（合格的红）

```
> engine@14.17.5 test
> vitest run tests/capacity-budget.test.ts

 RUN  v1.6.0 /Users/alex/cecelia

 ❯ tests/capacity-budget.test.ts (3)
   × computeWeeklyCap > returns floor(prs / days * 7) for typical case
   × computeWeeklyCap > returns 0 when no PRs
   × computeWeeklyCap > throws on non-positive days

 FAIL  tests/capacity-budget.test.ts > computeWeeklyCap > returns floor(prs / days * 7) for typical case
TypeError: computeWeeklyCap is not a function
 ❯ tests/capacity-budget.test.ts:6:12

 Test Files  1 failed (1)
      Tests  3 failed (3)
   Start at  09:12:33
   Duration  423ms

exit=1
```

**Reviewer 判断**：
- ✅ 有 `FAIL` + `×` + `Tests: 3 failed` → genuine failure
- ✅ `exit=1` non-zero
- ⚠️ `TypeError: computeWeeklyCap is not a function` 是"function not implemented yet"的预期错误，不是 syntax error 或 import error — **这是合格的红**（函数尚未实现，在导出层已经可 import 到模块，只是符号是 undefined）
- ✅ 3 个测试全部失败，与测试文件 3 个 `it` 对应

### .tdd-evidence/capacity-budget-green.log（合格的绿）

```
> engine@14.17.5 test
> vitest run tests/capacity-budget.test.ts

 RUN  v1.6.0 /Users/alex/cecelia

 ✓ tests/capacity-budget.test.ts (3) 14ms
   ✓ computeWeeklyCap > returns floor(prs / days * 7) for typical case
   ✓ computeWeeklyCap > returns 0 when no PRs
   ✓ computeWeeklyCap > throws on non-positive days

 Test Files  1 passed (1)
      Tests  3 passed (3)
   Start at  09:14:51
   Duration  312ms

exit=0
```

**Reviewer 判断**：
- ✅ 3 个 `✓` 对应 3 个 `it`，测试名与 red log 完全一致
- ✅ `Tests: 3 passed` + `exit=0`
- ✅ Start at 时间 `09:14:51` 晚于 red 的 `09:12:33`（about 2 min between red and green，合理）
- ✅ mtime 顺序：red 文件 < green 文件
- ✅ git 历史：test 文件与 impl 文件可能同一个 commit，也可能 test 先 commit —— 只要 impl 代码在 green log 时间戳前存在即可

**判决：APPROVED**

---

## 反面教材 ❌

### 案例 A：反向填充（最常见的作弊）

**症状**：implementer 先写了实现，测试一次过，然后手动 "制造" 一个 red log 交差。

**tests 文件**（同上）

**.tdd-evidence/capacity-budget-red.log**:
```
> engine@14.17.5 test
> vitest run tests/capacity-budget.test.ts

 FAIL  tests/capacity-budget.test.ts
 Error: expect(received).toBe(expected)
exit=1
```

**.tdd-evidence/capacity-budget-green.log**:
```
 ✓ tests/capacity-budget.test.ts (3) 14ms
 Tests: 3 passed
exit=0
```

**Reviewer 识别点**：
- ❌ red log 只有 5 行，没有 per-test breakdown（哪个测试失败看不出）。真实 vitest 输出不会这么简短
- ❌ red log 里没有 `computeWeeklyCap > returns floor(...)` 等具体测试名，无法交叉比对 green
- ❌ mtime 检查：若 `stat -c %Y` 发现 red > green，即刻 REJECT
- ❌ 可能 `git log -p tests/capacity-budget.test.ts` 发现测试文件是在 impl 文件之后才 commit 的

**判决：REJECTED — Check #2 (红 log plausibility 不足) + Check #5 (反向填充嫌疑)**

### 案例 B：语法错误冒充 red

**.tdd-evidence/foo-red.log**:
```
> vitest run tests/foo.test.ts

 FAIL  tests/foo.test.ts
Error: Cannot find module '../lib/foo' from 'tests/foo.test.ts'
    at ...

exit=1
```

**Reviewer 识别点**：
- ❌ 失败原因是 `Cannot find module` —— 这是 import 错误，不是测试断言失败
- ❌ 合理的 red 应该是：模块能 import 到，但 symbol/function 不存在或行为不对
- ❌ import error 往往是"测试文件刚写还没 save 实现"导致，不代表真正的 TDD 红阶段

**判决：REJECTED — Check #2 (红 log 必须是 genuine assertion failure，不接受 syntax/import error)**

### 案例 C：测试内容在红到绿之间被改（moving goalpost）

**red log 含**：`✗ should handle negative input by throwing`
**green log 含**：`✓ should handle negative input by returning 0`

**Reviewer 识别点**：
- ❌ 两个测试名不一致 —— 红阶段要求"throw"，绿阶段改成"return 0"
- ❌ 这是 implementer 把测试改软让它过，不是真正让实现满足原设计
- ❌ 典型 "moving goalpost"：改测试而不是改实现

**判决：REJECTED — Check #4 (test identity must be stable from red to green)**

### 案例 D：绿 log 伪造（没真跑）

**.tdd-evidence/foo-green.log**:
```
All tests passed
exit=0
```

**Reviewer 识别点**：
- ❌ 只有 2 行，没有任何 vitest/jest/mocha 的 runner 标识
- ❌ 没有测试文件路径、测试数量、duration
- ❌ 一看就是手写的假输出

**判决：REJECTED — Check #3 (green log 必须含 per-test output 和 runner 元信息)**

### 案例 E：exemption 滥用

implementer DONE 报告：
> "TDD exemption claimed: this is a pure refactor renaming `getFoo` → `getBar`."

Reviewer 查 diff，发现：
- `git diff` 不只是重命名 —— 还改了内部 if 分支、新增了一个 null 检查
- 没有对应的 regression test 覆盖新加的 null 检查

**判决：REJECTED — Check #6 (exemption 不成立：diff 含行为变化，必须提供 TDD artifact)**

---

## Reviewer 执行清单（快速判官）

面对一个 DONE 报告，Reviewer 机械地跑完：

1. `ls .tdd-evidence/<module>-{red,green}.log` → 两个文件都在？
2. `tail -30 .tdd-evidence/<module>-red.log` → 含 FAIL/✗/exit=非0？失败类型是 assertion 不是 syntax？
3. `tail -15 .tdd-evidence/<module>-green.log` → 含 PASS/✓/exit=0？≥ 3 行？
4. `grep -oE "(describe|it)\(['\"][^'\"]+" tests/<module>.test.ts | sort -u` vs 两个 log 的测试名 → 完全一致？
5. `stat -c %Y .tdd-evidence/<module>-{red,green}.log` → red < green？
6. 若声称 exemption → `git diff` 核实真的没有行为变化？

任一失败 → 写清楚 "Check #N failed: <具体原因>" → REJECTED。
全部通过 → Core Check #6 PASS，进入其余 compliance 项的审查。

---

## 为什么这套机制能 work

单一信号易伪造：
- 只看 "exit code 非零" → 可以故意 `exit 1` 制造
- 只看 "有 FAIL 字样" → 可以手写 "FAIL" 糊弄
- 只看 "mtime 顺序" → 可以 `touch -t` 倒改时间（但得 root 或用户本人，且 CI 上无法做）

**三层交叉验证**（log 内容一致性 + mtime 顺序 + git 历史）是关键：让伪造成本高于诚实跑 TDD 的成本。多数 implementer 会选择遵守规则。

**exemption 机制**保留弹性：强制所有任务都 TDD 会导致合理任务卡死（纯 refactor、文档改动、配置调整）。Reviewer 负责判官 exemption 是否正当，把人类判断力放回流程关键点。
