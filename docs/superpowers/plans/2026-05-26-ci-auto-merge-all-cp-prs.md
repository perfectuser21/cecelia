# CI Auto-merge 扩展到所有 cp-* PR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 所有 cp-* 分支 PR CI 全绿后自动合并，去掉 harness label 限制。

**Architecture:** 修改 `.github/workflows/ci.yml` auto-merge job 内部的 label 判断逻辑，替换为分支名前缀判断。同时更新注释和 step name 以反映新行为。

**Tech Stack:** GitHub Actions bash

---

## File Structure

- Modify: `.github/workflows/ci.yml`（auto-merge job，第 1331-1385 行）

---

### Task 1: 修改 ci.yml auto-merge job

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: 确认当前内容**

运行：
```bash
sed -n '1331,1352p' .github/workflows/ci.yml
```

期望看到：
```
  # ─── Auto-merge（harness label PR，CI 通过后自动合并）────────
  auto-merge:
  ...
          LABELS=$(gh pr view "$PR_NUMBER" --json labels --jq '.labels[].name' 2>/dev/null || echo "")
          if ! echo "$LABELS" | grep -q "harness"; then
            echo "ℹ️  No harness label, skipping auto-merge"
            exit 0
          fi
```

- [ ] **Step 2: 应用改动**

将 `.github/workflows/ci.yml` 中以下内容：

```yaml
  # ─── Auto-merge（harness label PR，CI 通过后自动合并）────────
  auto-merge:
    needs: [ci-passed]
    if: needs.ci-passed.result == 'success' && github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - name: Auto-merge harness PR（含重试 + Brain 失败回写）
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          BRAIN_URL: ${{ vars.BRAIN_URL || 'http://localhost:5221' }}
          PR_NUMBER: ${{ github.event.pull_request.number }}
          PR_BODY: ${{ github.event.pull_request.body }}
        run: |
          # 实时检查标签（不依赖事件 payload — harness 标签在 PR 创建后可能才添加，事件 payload 中不含）
          LABELS=$(gh pr view "$PR_NUMBER" --json labels --jq '.labels[].name' 2>/dev/null || echo "")
          if ! echo "$LABELS" | grep -q "harness"; then
            echo "ℹ️  No harness label, skipping auto-merge"
            exit 0
          fi
```

替换为：

```yaml
  # ─── Auto-merge（所有 cp-* 分支 PR，CI 通过后自动合并）────────
  auto-merge:
    needs: [ci-passed]
    if: needs.ci-passed.result == 'success' && github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - name: Auto-merge cp-* PR（含重试 + Brain 失败回写）
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          BRAIN_URL: ${{ vars.BRAIN_URL || 'http://localhost:5221' }}
          PR_NUMBER: ${{ github.event.pull_request.number }}
          PR_BODY: ${{ github.event.pull_request.body }}
        run: |
          # 所有 cp-* 分支 PR CI 绿即自动合并（stop hook 删除后统一由此机制处理）
          HEAD_BRANCH="${{ github.head_ref }}"
          if ! echo "$HEAD_BRANCH" | grep -qE '^cp-'; then
            echo "ℹ️  Not a cp-* branch, skipping auto-merge"
            exit 0
          fi
```

- [ ] **Step 3: 验证改动正确**

运行：
```bash
sed -n '1331,1352p' .github/workflows/ci.yml
```

期望看到：
```
  # ─── Auto-merge（所有 cp-* 分支 PR，CI 通过后自动合并）────────
  auto-merge:
  ...
          HEAD_BRANCH="${{ github.head_ref }}"
          if ! echo "$HEAD_BRANCH" | grep -qE '^cp-'; then
            echo "ℹ️  Not a cp-* branch, skipping auto-merge"
            exit 0
          fi
```

- [ ] **Step 4: DoD + commit**

```bash
cat > DOD.md << 'EOF'
# DoD: fix(ci) — auto-merge 扩展到所有 cp-* PR

## Branch
cp-0526203448-ci-auto-merge-all-cp-prs

## Changes

- [x] [BEHAVIOR] auto-merge job 对 cp-* 分支 PR CI 绿即触发（不再限 harness label）
  Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');if(!c.includes(\"grep -qE '^cp-'\"))process.exit(1);console.log('ok')"

- [x] [ARTIFACT] auto-merge job 注释和 step name 已更新为"所有 cp-* 分支"
  Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');if(!c.includes('所有 cp-* 分支 PR，CI 通过后自动合并'))process.exit(1);console.log('ok')"

- [x] [BEHAVIOR] 非 cp-* 分支 PR 不触发 auto-merge
  Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');if(!c.includes('Not a cp-* branch, skipping auto-merge'))process.exit(1);console.log('ok')"
EOF

git add .github/workflows/ci.yml DOD.md
git commit -m "fix(ci): auto-merge 扩展到所有 cp-* PR，去掉 harness label 限制

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```
