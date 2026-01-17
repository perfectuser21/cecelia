# Step 8: CI 通过

> 等待 CI 通过，失败则回退修复

**前置条件**：step >= 7（PR 已创建）
**完成后设置状态**：
```bash
git config branch."$BRANCH_NAME".step 8
```

---

## 质检流程

```
PR 创建（Step 7 已完成本地 Claude review）
    │
    ▼
┌─────────────────────────────────────┐
│  等待 CI：                          │
│    • version-check                  │
│    • test                           │
│    • shell scripts check            │
└─────────────────────────────────────┘
    │
    ├── CI 失败 → 回退 step 4 → 修复 → 重新循环
    │
    └── CI 通过 → step 8 → 等待合并
```

---

## 使用轮询脚本

```bash
bash skills/dev/scripts/wait-for-merge.sh "$PR_URL"
```

**退出码**：
- `0` = PR 已合并
- `1` = 需要修复
- `2` = 超时

---

## CI 失败修复

```bash
# 1. 读取 CI 错误
gh run view --log-failed

# 2. 回退到 step 4
git config branch."$BRANCH_NAME".step 4

# 3. 修复代码

# 4. 重新走流程
# step 4 → 5 → 6 → 7（自动 review）→ 8
```

---

## 注意

- **Claude review 在 Step 7 之前本地完成**（pre-pr-check.sh）
- CI 只检查 test/typecheck/shell scripts
- 失败后回退到 step 4，重新循环
