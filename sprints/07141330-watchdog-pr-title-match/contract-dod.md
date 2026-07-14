# Contract DoD：watchdog PR 标题 [短号] 匹配

- **Task ID**: d276bdae-e69f-4b87-9ee1-5b0e552acb2b
- **Sprint Dir**: sprints/07141330-watchdog-pr-title-match

---

## [BEHAVIOR] 条目

### [BEHAVIOR-1] 标题含 [短号]、分支名不含短号 → 函数返回该 PR（核心 bug fix）

**描述**：`_discoverPrFromGithub` 当 mock execFn 返回只有标题含 `[abcd1234]`、
`headRefName` 不含 `abcd1234` 的 PR 列表时，函数必须返回该 PR 而非 null。

**触发条件**：
- `headRefName = 'cp-xxx-no-short'`（不含 short）
- `title = 'fix(ci-poll): some description [abcd1234]'`
- `state = 'OPEN'`
- `short = 'abcd1234'`

**断言**：返回对象 `.url` 为该 PR 的 url，`.state === 'OPEN'`

**manual:bash 验收命令**：
```bash
cd /workspace && npx vitest run packages/brain/src/__tests__/harness-relay-watchdog-pr-discovery.test.js --reporter=verbose 2>&1 | grep -E "BEHAVIOR-1|标题命中.*分支名不含|✓|✗|PASS|FAIL"
```

---

### [BEHAVIOR-2] 分支名含短号（既有路径）→ 不回归

**描述**：`headRefName.includes(short)` 的既有匹配路径在新代码中继续生效，
新增标题匹配不得破坏该路径。

**触发条件**：
- `headRefName = 'cp-aaaabbbb-ws'`（含 short `aaaabbbb`）
- `title = 'some unrelated title'`（不含 [short]）
- `state = 'OPEN'`

**断言**：返回对象 `.headRefName` 包含 short

**manual:bash 验收命令**：
```bash
cd /workspace && npx vitest run packages/brain/src/__tests__/harness-relay-watchdog-pr-discovery.test.js --reporter=verbose 2>&1 | grep -E "BEHAVIOR-2|分支名命中|✓|✗|PASS|FAIL"
```

---

### [BEHAVIOR-3] MERGED 优先于 OPEN（跨路径）

**描述**：同一 short 对应多个 PR，其中 MERGED 由标题命中、OPEN 由分支名命中，
函数必须返回 MERGED PR。

**触发条件**：
- PR-A：`headRefName = 'cp-aaaabbbb-ws'`，`title = 'no'`，`state = 'OPEN'`（分支名命中）
- PR-B：`headRefName = 'other-branch'`，`title = 'fix [aaaabbbb]'`，`state = 'MERGED'`（标题命中）

**断言**：返回 PR-B，`state === 'MERGED'`

**manual:bash 验收命令**：
```bash
cd /workspace && npx vitest run packages/brain/src/__tests__/harness-relay-watchdog-pr-discovery.test.js --reporter=verbose 2>&1 | grep -E "BEHAVIOR-3|MERGED.*优先|✓|✗|PASS|FAIL"
```

---

### [BEHAVIOR-4] 松散子串（不带方括号）不命中 → 返回 null（防御回归）

**描述**：PR 标题仅含 short 的纯子串（如 `aaaabbbb`），但不以 `[aaaabbbb]` 方括号形式出现，
函数必须返回 null，防止误匹配。

**触发条件**：
- `headRefName = 'other-branch'`（不含 short）
- `title = 'fix aaaabbbb issue'`（含 short 但无方括号）
- `state = 'OPEN'`

**断言**：返回 `null`

**manual:bash 验收命令**：
```bash
cd /workspace && npx vitest run packages/brain/src/__tests__/harness-relay-watchdog-pr-discovery.test.js --reporter=verbose 2>&1 | grep -E "BEHAVIOR-4|松散|方括号|✓|✗|PASS|FAIL"
```

---

## 全量验收命令（CI 对标）

```bash
cd /workspace && npx vitest run packages/brain/src/__tests__/harness-relay-watchdog-pr-discovery.test.js --reporter=verbose
```

期望输出：所有测试 PASS，零 FAIL。

## 变更范围验收

```bash
git diff --name-only HEAD~1 HEAD 2>/dev/null || git diff --name-only
```

期望只出现以下文件（plus sprint 产物）：
- `packages/brain/src/harness-relay-watchdog.js`
- `packages/brain/src/__tests__/harness-relay-watchdog-pr-discovery.test.js`
