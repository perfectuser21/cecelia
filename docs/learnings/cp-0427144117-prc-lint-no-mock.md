# Learning: PR-C lint-no-mock-only-test（2026-04-27）

- 影响：brain 单测可信度根因 (28/100 → ?)
- 触发：4 agent 审计找出 49 个 heavy-mock test 文件 + PR #2660 dispatcher Phase 2.5 drain bug

---

### 根本原因

lint-test-quality（PR #2666）拦了 stub（只 grep src 不调函数）和 .skip，但**没拦"调函数但所有依赖全 mock"**：

```js
vi.mock('../db.js')
vi.mock('../executor.js')
vi.mock('../bridge.js')
// ... 30 个 mock
const result = await dispatchNextTask(['goal']);
expect(result.dispatched).toBe(true);  // 全 mock 路径，prod 行为完全无验
```

PR #2660 dispatcher Phase 2.5 drain bug 就是这种：dispatcher 单测全 vi.mock，单测全过 → CI 绿 → merge → deploy → **当场 drain 24 个本来卡死的任务**。mock 层下完全看不到。

---

### 修复

新增 lint-no-mock-only-test.sh，规则：
- 仅作用于 PR diff 新增 test 文件
- vi.mock 数 ≥ 30 + 无配套真覆盖 → fail
- 配套真覆盖 = smoke.sh / integration test / 文件本身在 /integration/

不一刀切：light mock (<30) 和 grandfather 老测试都放。重 mock 必须配真路径。

---

### 下次预防

- [ ] heavy mock test 不是错，只要配套有真路径覆盖就 OK。这是"cost vs coverage"的 trade-off — mock 写得快，smoke 写得慢，但只 mock = 假绿
- [ ] 30 是凭审计数据定的（大部分老 test 在 5-15，heavy 是 30+）。如果误伤过多，调高阈值或加白名单
- [ ] 这是机器化纪律的"补漏"模式 — 每加一条 lint，AI 学到一种新绕法，迭代下来就把绕路堵死
- [ ] 100% foundation 路线还剩 PR-D (executor smoke) / PR-E (cortex) / PR-F (thalamus)
