---
id: learning-cp-03161710-verify-coverage-delta
version: 1.1.0
created: 2026-03-16
updated: 2026-03-16
branch: cp-03161710-verify-coverage-delta
changelog:
  - 1.1.0: 补充 coverage-delta 实际观察结果
  - 1.0.0: 初始版本
---

# Learning: 验证 coverage-delta CI job 行为

## 任务背景

创建最小化 feat Brain PR（新增 formatDuration 工具函数），观察 coverage-delta CI job 的实际行为。

## coverage-delta Job 观察结果（核心发现）

### 实际行为

coverage-delta job **启动失败**，错误信息：

```
Unable to resolve action `anuraag016/Jest-Coverage-Diff@main`, unable to find version `main`
```

### 根本原因

`ci-l3-code.yml` 中引用的 GitHub Action：
```yaml
- name: Coverage Delta Check
  uses: anuraag016/Jest-Coverage-Diff@main
```

**`@main` 版本不存在**。该 action 的可用版本可能是 `@v1`、`@v2` 等 tag，而不是 `main` 分支。

### 影响

- coverage-delta job 因 action 解析失败，在 Setup 阶段就崩溃（`failure`）
- L3 Code Gate 将 coverage-delta failure 判定为 L3 失败
- 所有 feat Brain PR 的 L3 都会失败（除非修复 action 版本引用）

### 其他 CI Jobs 表现

| Job | 结果 | 备注 |
|-----|------|------|
| L1 Process Gate | ✅ 通过 | 含 Learning Format Gate + DoD Verification Gate |
| L2 Consistency Gate | ✅ 通过 | |
| L3 Code Gate | ❌ 失败 | 因 coverage-delta 失败导致 |
| L4 Runtime Gate | ✅ 通过 | |
| Coverage Delta Check | ❌ 失败 | Action `@main` 版本不存在 |

### DoD/Learning 格式陷阱（本 PR 踩坑记录）

1. **CI 优先使用 `.task-{branch}.md`**（如果存在），不是 `.dod-{branch}.md`
   - task card 里的 DoD 条目也必须是 `[x]` 已勾选状态
   - task card 和单独的 dod 文件都要保持一致

2. **`[ARTIFACT]` 类型的 DoD 条目，`manual:ls` 命令会被 CI 拒绝**
   - 正确：`manual:node -e "require('fs').existsSync(...)..."`
   - 错误：`manual:ls packages/brain/src/...`

3. **Learning 文件必须在 push 之前就存在于 PR 中**
   - 不能先 push 再补 Learning（L1 Process Gate 会立即检查并失败）

## 下次预防

- [ ] 修复 `anuraag016/Jest-Coverage-Diff@main` → 正确版本（新 PR 修复）
- [ ] 在 Step 2 写代码时就创建 Learning 文件框架（不要等到 Step 4）
- [ ] `[ARTIFACT]` 条目避免用 `ls`，改用 `node fs.existsSync` 或 `! grep -q`
- [ ] push 前本地运行 `GITHUB_HEAD_REF=<branch> node packages/engine/scripts/devgate/check-dod-mapping.cjs`
