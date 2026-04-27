# engine-ship SKILL.md v16.1.0 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 main 中已修改的 engine-ship SKILL.md（v16.1.0）应用到 worktree，同步 Engine 版本 bump 到 18.16.0，更新 feature-registry.yml，创建 [CONFIG] PR。

**Architecture:** 纯 Config 类改动。复制 main 中的 SKILL.md 改动到 worktree 分支，bump Engine 版本 5 文件，追加 feature-registry changelog 条目，运行 generate-path-views.sh，提交并推送。

**Tech Stack:** bash、git、node（文件内容验证）

---

### Task 1: 复制 SKILL.md 改动到 worktree 并验证

**Files:**
- Modify: `packages/engine/skills/engine-ship/SKILL.md`

- [ ] **Step 1: 复制 main 中的 SKILL.md 到 worktree**

```bash
cd /Users/administrator/worktrees/cecelia/engine-ship-skill-v16.1.0
cp /Users/administrator/perfect21/cecelia/packages/engine/skills/engine-ship/SKILL.md \
   packages/engine/skills/engine-ship/SKILL.md
```

- [ ] **Step 2: 验证版本为 16.1.0**

```bash
node -e "const c=require('fs').readFileSync('packages/engine/skills/engine-ship/SKILL.md','utf8');if(!c.includes('version: 16.1.0'))process.exit(1);console.log('OK: version 16.1.0')"
```
Expected: `OK: version 16.1.0`

- [ ] **Step 3: 验证包含 callback-brain-task.sh**

```bash
grep -q 'callback-brain-task' packages/engine/skills/engine-ship/SKILL.md && echo "OK" || exit 1
```
Expected: `OK`

---

### Task 2: Engine 版本 bump（5 个文件：18.15.0 → 18.16.0）

**Files:**
- Modify: `packages/engine/package.json`
- Modify: `packages/engine/package-lock.json`
- Modify: `packages/engine/VERSION`
- Modify: `packages/engine/.hook-core-version`
- Modify: `packages/engine/regression-contract.yaml`

- [ ] **Step 1: bump packages/engine/package.json**

```bash
cd /Users/administrator/worktrees/cecelia/engine-ship-skill-v16.1.0
sed -i '' 's/"version": "18.15.0"/"version": "18.16.0"/' packages/engine/package.json
```

- [ ] **Step 2: bump packages/engine/package-lock.json**

```bash
# package-lock.json 有两处 version 字段（第一处是包自身，第二处是 packages[""] 下）
sed -i '' '0,/"version": "18.15.0"/{s/"version": "18.15.0"/"version": "18.16.0"/}' packages/engine/package-lock.json
# 再替换第二处
sed -i '' 's/"version": "18.15.0"/"version": "18.16.0"/' packages/engine/package-lock.json
```

- [ ] **Step 3: bump packages/engine/VERSION**

```bash
echo "18.16.0" > packages/engine/VERSION
```

- [ ] **Step 4: bump packages/engine/.hook-core-version**

```bash
echo "18.16.0" > packages/engine/.hook-core-version
```

- [ ] **Step 5: bump packages/engine/regression-contract.yaml**

```bash
sed -i '' 's/^version: 18.15.0/version: 18.16.0/' packages/engine/regression-contract.yaml
```

- [ ] **Step 6: 验证 5 文件全部已 bump**

```bash
node -e "const v=require('./packages/engine/package.json').version;if(v!=='18.16.0'){console.error('package.json FAIL:',v);process.exit(1)}console.log('package.json OK')"
grep "^18.16.0" packages/engine/VERSION && echo "VERSION OK" || exit 1
grep "^18.16.0" packages/engine/.hook-core-version && echo ".hook-core-version OK" || exit 1
grep "^version: 18.16.0" packages/engine/regression-contract.yaml && echo "regression-contract OK" || exit 1
```
Expected: 4 行 OK

---

### Task 3: 更新 feature-registry.yml + 运行 generate-path-views.sh

**Files:**
- Modify: `packages/engine/feature-registry.yml`

- [ ] **Step 1: 在 feature-registry.yml changelog 顶部插入新条目**

在 `changelog:` 行下方、现有第一个条目之前，插入：

```yaml
  - version: "18.16.0"
    date: "2026-04-27"
    change: "feat"
    description: "[CONFIG] engine-ship SKILL.md v16.1.0 — §2 新增 callback-brain-task.sh 调用步骤，自动回写 Brain task status=completed，实现 CLAUDE.md §8 零人为交互点。minor bump 18.15.0 → 18.16.0。"
    files:
      - "packages/engine/skills/engine-ship/SKILL.md (16.0.0 → 16.1.0)"
      - "Engine 5 处版本文件 18.16.0"
```

- [ ] **Step 2: 同步更新 feature-registry.yml 头部 version**

```bash
sed -i '' 's/^version: "18.15.0"/version: "18.16.0"/' packages/engine/feature-registry.yml
sed -i '' "s/^updated: \"2026-04-27\"/updated: \"2026-04-27\"/" packages/engine/feature-registry.yml
```

- [ ] **Step 3: 运行 generate-path-views.sh**

```bash
bash packages/engine/scripts/generate-path-views.sh
```
Expected: 无错误输出

---

### Task 4: 提交所有改动

- [ ] **Step 1: 检查 git diff 确认改动正确**

```bash
cd /Users/administrator/worktrees/cecelia/engine-ship-skill-v16.1.0
git diff --stat
```

- [ ] **Step 2: 提交**

```bash
git add packages/engine/skills/engine-ship/SKILL.md \
        packages/engine/package.json \
        packages/engine/package-lock.json \
        packages/engine/VERSION \
        packages/engine/.hook-core-version \
        packages/engine/regression-contract.yaml \
        packages/engine/feature-registry.yml
git add -u  # 任何 generate-path-views.sh 生成的文件变更
git commit -m "$(cat <<'EOF'
feat(engine): [CONFIG] engine-ship SKILL.md v16.1.0 — 自动回写 Brain task

新增 callback-brain-task.sh 调用步骤，实现 CLAUDE.md §8 零人为交互点。
Engine 版本 bump 18.15.0 → 18.16.0。

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: 写 Learning 文件

**Files:**
- Create: `docs/learnings/cp-0427172630-engine-ship-skill-v16.1.0.md`

- [ ] **Step 1: 写 Learning 文件**

```bash
cat > docs/learnings/cp-0427172630-engine-ship-skill-v16.1.0.md << 'EOF'
## engine-ship SKILL.md v16.1.0 — callback-brain-task 自动回写（2026-04-27）

### 根本原因

engine-ship §2 只 fire-learnings-event，未调用 callback-brain-task.sh，
导致 Brain task status 不自动变 completed，违反 CLAUDE.md §8 零人为交互点原则。

### 下次预防

- [ ] engine-ship §2 新 fire 事件后，同步确认是否需要对应的 callback 步骤
- [ ] CLAUDE.md §8 要求的回写动作必须在 SKILL.md 中有显式步骤，不依赖人工提醒
EOF
```

- [ ] **Step 2: 提交 Learning**

```bash
git add docs/learnings/cp-0427172630-engine-ship-skill-v16.1.0.md
git commit -m "$(cat <<'EOF'
docs: add learning for cp-0427172630-engine-ship-skill-v16.1.0

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Push 并创建 [CONFIG] PR

- [ ] **Step 1: Push**

```bash
git push origin HEAD
```

- [ ] **Step 2: 创建 PR**

```bash
gh pr create \
  --title "[CONFIG] feat(engine): engine-ship SKILL.md v16.1.0 — 自动回写 Brain task status" \
  --body "$(cat <<'EOF'
## Summary

- engine-ship SKILL.md §2 新增 `callback-brain-task.sh` 调用步骤，自动回写 Brain task status=completed
- 实现 CLAUDE.md §8「任务完成后必须回写」的自动化，消除人为交互点
- Engine 版本 bump：18.15.0 → 18.16.0

## DoD

- [x] [ARTIFACT] packages/engine/skills/engine-ship/SKILL.md 版本为 16.1.0
  Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/skills/engine-ship/SKILL.md','utf8');if(!c.includes('version: 16.1.0'))process.exit(1)"
- [x] [BEHAVIOR] engine-ship SKILL.md 包含 callback-brain-task.sh 调用步骤
  Test: manual:bash -c "grep -q 'callback-brain-task' packages/engine/skills/engine-ship/SKILL.md"
- [x] [ARTIFACT] Engine 版本已 bump 到 18.16.0（package.json/VERSION/.hook-core-version/regression-contract.yaml）
  Test: manual:node -e "const v=require('./packages/engine/package.json').version;if(v!=='18.16.0')process.exit(1)"

## Test plan

- [x] SKILL.md 版本字段验证
- [x] callback-brain-task.sh 文本存在验证
- [x] Engine 5 个版本文件一致性验证

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
