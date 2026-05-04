# CI Gate 彻底修复 设计文档

**日期**：2026-05-04
**分支**：cp-0504085825-ci-gate-fix
**Task ID**：c7af8b9e-0233-4f9d-8875-9753e1478b70

---

## 问题背景

探索发现 `.github/workflows/ci.yml` 存在两类问题：

1. **P1（Bug）**：`ci-passed` job 的 `check()` 调用列表缺少 `harness-contract-lint`，该 job 失败时不阻断 PR 合并。
2. **P2（低效）**：`dod-behavior-dynamic` 和 `harness-dod-integrity` 无变更检测，每次 PR 都无条件运行，`dod-behavior-dynamic` 额外启动 postgres service 容器造成资源浪费。

---

## 修复方案

### P1：harness-contract-lint 静默失效修复

**位置**：`ci-passed` job 的 `run` 脚本，`check "harness-dod-integrity"` 之后

**修复**：追加一行

```yaml
check "harness-contract-lint" "${{ needs.harness-contract-lint.result }}"
```

**原因**：`harness-contract-lint` 已在 `needs:` 列表（GitHub 会等待它完成），但 `check()` 不调用它，failure 无法传播到 `ci-passed`。

---

### P2：dod 相关 job 条件化触发

**Step 1**：`changes` job 新增 `dod` output

检测逻辑：PR diff 中是否有 DoD 相关文件（`DoD.md`、`task-card.md`、`.task-*.md`、`.dod-*.md`）。

```bash
echo "dod=$(echo "$CHANGED" | grep -qE '^(DoD\.md|task-card\.md|\.task-|\.dod-)' && echo true || echo false)" >> $GITHUB_OUTPUT
```

**Step 2**：`dod-behavior-dynamic` 加条件

```yaml
needs: [changes]
if: needs.changes.outputs.dod == 'true'
```

效果：PR 无 DoD 文件时，整个 job 跳过，postgres service 容器不启动。

**Step 3**：`harness-dod-integrity` 加条件

```yaml
needs: [changes]
if: needs.changes.outputs.dod == 'true'
```

效果：PR 无 DoD 文件时，整个 job 跳过（本身较轻量，但保持一致性）。

**`ci-passed` needs 无需改动**：`dod-behavior-dynamic` 和 `harness-dod-integrity` 已在列表中，skipped 状态在 `check()` 中被识别为 `⏭️`（不是 failure）。

---

### P3：frontend E2E 独立 workflow（不动）

`ci-l5-e2e-frontend.yml` 是独立 workflow，无法在 `ci.yml` 的 `ci-passed` 中直接 `needs`。目前 E2E 套件仅有 2 个测试文件，稳定性未验证。**本次不并入 ci-passed 门禁**，保留现有设计。

---

## 变更范围

**唯一修改文件**：`.github/workflows/ci.yml`

| 位置 | 改动 |
|------|------|
| `changes` job outputs | 新增 `dod` output |
| `changes` job run | 新增 dod 检测一行 |
| `dod-behavior-dynamic` | 加 `needs: [changes]` + `if` 条件 |
| `harness-dod-integrity` | 加 `needs: [changes]` + `if` 条件 |
| `ci-passed` run script | 加 `check "harness-contract-lint"` 一行 |

---

## 测试策略

**类型**：Trivial config change（无运行时逻辑），1 个 node 文件检查测试即可。

**DoD `[BEHAVIOR]` 验证**：

```bash
# P1：验证 check "harness-contract-lint" 已加入
node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8'); if(!c.includes('check \"harness-contract-lint\"')) process.exit(1)"

# P2：验证 changes job 含 dod output
node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8'); if(!c.includes('dod=')) process.exit(1)"

# P2：验证 dod-behavior-dynamic 含 needs changes
node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8'); const idx=c.indexOf('dod-behavior-dynamic:'); if(!c.slice(idx,idx+300).includes('needs: [changes]')) process.exit(1)"
```

**真正的 CI 验证**：本 PR 自身跑一次完整 CI，观察 ci-passed 结果。

---

## 成功标准

- `harness-contract-lint` 失败时，`ci-passed` 必须失败
- PR 无 DoD 文件时，`dod-behavior-dynamic` 和 `harness-dod-integrity` 状态为 `skipped`
- 本 PR 自身 CI 全绿
