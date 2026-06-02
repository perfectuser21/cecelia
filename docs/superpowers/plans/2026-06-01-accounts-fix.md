# ACCOUNTS 修正 account2+account3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** 把 Brain 账号列表从 [account1, account2] 改为 [account2, account3]，account1 无凭据废弃，account3 已恢复。

**Architecture:** 单文件配置修改 + 联动测试更新，改完重部署 Brain。

**Tech Stack:** Node.js, Vitest

---

### Task 1: 改 ACCOUNTS 配置 + 更新测试

**Files:**
- Modify: `packages/brain/src/account-usage.js:16`
- Modify: `packages/brain/src/__tests__/account-usage.test.js:241-252`

- [ ] **Step 1: 写 failing test — commit 1（Red）**

在 `packages/brain/src/__tests__/account-usage.test.js` 的 `isAllAccountsSpendingCapped` describe 块里，把 L241-252 的两个测试改为：

```js
it('部分账号被标记时应返回 false', () => {
  // ACCOUNTS=[account2, account3]，只 mark account2 → 部分 capped
  const futureTime = new Date(Date.now() + 7200000).toISOString();
  markSpendingCap('account2', futureTime);
  expect(isAllAccountsSpendingCapped()).toBe(false);
});

it('所有账号都被标记时应返回 true', () => {
  // ACCOUNTS=[account2, account3]，全部 mark → 全 capped
  const futureTime = new Date(Date.now() + 7200000).toISOString();
  markSpendingCap('account2', futureTime);
  markSpendingCap('account3', futureTime);
  expect(isAllAccountsSpendingCapped()).toBe(true);
});
```

- [ ] **Step 2: 跑测试确认 FAIL**

```bash
cd packages/brain && node_modules/.bin/vitest run src/__tests__/account-usage.test.js --reporter=verbose 2>&1 | grep -E "FAIL|×|✗|isAllAccounts" | head -10
```

期望：`isAllAccountsSpendingCapped` 相关测试 FAIL（因为 ACCOUNTS 还是 account1+account2）

- [ ] **Step 3: commit 1（Red）**

```bash
git add packages/brain/src/__tests__/account-usage.test.js
git commit -m "test(account): failing test for ACCOUNTS=[account2,account3] (Red)"
```

- [ ] **Step 4: 改 account-usage.js L16（Green）**

```js
// 改前
const ACCOUNTS = ['account1', 'account2']; // H14: account3 退订（403），见 docs/learnings/cp-0510075509-h14-remove-account3.md

// 改后
const ACCOUNTS = ['account2', 'account3']; // B51: account1 无 .credentials.json 永久 AUTH_FAILED；account3 凭据已恢复
```

- [ ] **Step 5: 跑测试确认 PASS**

```bash
cd packages/brain && node_modules/.bin/vitest run src/__tests__/account-usage.test.js --reporter=verbose 2>&1 | tail -8
```

期望：全 PASS

- [ ] **Step 6: commit 2（Green）**

```bash
git add packages/brain/src/account-usage.js
git commit -m "fix(account): B51 — ACCOUNTS 改 account2+account3，account1 无凭据废弃"
```

---

### Task 2: 新增 smoke test

**Files:**
- Create: `packages/brain/scripts/smoke/accounts-config-smoke.sh`

- [ ] **Step 1: 创建 smoke 脚本**

新建文件 `packages/brain/scripts/smoke/accounts-config-smoke.sh`，内容：

```bash
#!/usr/bin/env bash
set -e

# 验证 account2 凭据文件存在
[ -f "$HOME/.claude-account2/.credentials.json" ] && echo "OK: account2 credentials exist" || { echo "FAIL: account2 credentials missing"; exit 1; }

# 验证 account3 凭据文件存在
[ -f "$HOME/.claude-account3/.credentials.json" ] && echo "OK: account3 credentials exist" || { echo "FAIL: account3 credentials missing"; exit 1; }

# 验证 ACCOUNTS 配置正确
grep "const ACCOUNTS" packages/brain/src/account-usage.js | grep -q "account2.*account3" && echo "OK: ACCOUNTS=[account2,account3]" || { echo "FAIL: ACCOUNTS 配置不正确"; exit 1; }

echo "accounts-config smoke 全部通过"
```

- [ ] **Step 2: 添加执行权限并本地验证**

```bash
chmod +x packages/brain/scripts/smoke/accounts-config-smoke.sh
bash packages/brain/scripts/smoke/accounts-config-smoke.sh
```

期望输出：
```
OK: account2 credentials exist
OK: account3 credentials exist
OK: ACCOUNTS=[account2,account3]
accounts-config smoke 全部通过
```

- [ ] **Step 3: commit**

```bash
git add packages/brain/scripts/smoke/accounts-config-smoke.sh
git commit -m "feat(account): B51 — 新增 accounts-config smoke test"
```

---

### Task 3: Push + PR

- [ ] **Step 1: Push**

```bash
git push origin HEAD
```

- [ ] **Step 2: 创建 PR**

```bash
gh pr create \
  --title "fix(account): B51 — ACCOUNTS 修正为 account2+account3，account1 无凭据废弃" \
  --body "$(cat <<'EOF'
## Summary
- account1 无 .credentials.json，每次调用 401，auth-circuit-breaker 反复封禁
- account3 凭据有效（MAX 20x），H14 时因 403 误移除，现已恢复
- 实际只有 account2 单独工作，打满 5h 窗口
- 改为 [account2, account3]，恢复双账号调度

## Changes
- account-usage.js L16: ACCOUNTS 列表
- account-usage.test.js: isAllAccountsSpendingCapped 测试更新
- 新增 smoke: accounts-config-smoke.sh
EOF
)"
```
