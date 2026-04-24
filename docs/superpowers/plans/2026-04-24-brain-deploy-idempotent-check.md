# brain-deploy.sh 幂等检查实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `scripts/brain-deploy.sh` 的 `docker compose up -d` 前加 image SHA 幂等检查，相同则跳过 recreate。

**Architecture:** 在 Docker 模式 `[7/8] Starting container...` 块内部、`docker compose up -d` 调用前插入 5-7 行 bash。用 `docker inspect` 比较当前容器 image ID 和目标 tag image ID，相同则设 `DEPLOY_SUCCESS=true` 后 `exit 0`。

**Tech Stack:** bash + docker CLI + node-based DoD test

---

## File Structure

- **Modify**: `scripts/brain-deploy.sh`（只改 Docker 模式 `[7/8]` 块，launchd 模式不动）
- **Create**: `docs/learnings/cp-0424122436-brain-deploy-idempotent-check.md`（CI Learning Gate 要求）
- **Create/Update**: PRD 和 DoD 文件（branch-protect.sh 要求）

---

## Task 1: 写 PRD 和 DoD

**Files:**
- Create: `prd-cp-0424122436-brain-deploy-idempotent-check.md`
- Create: `.dod-cp-0424122436-brain-deploy-idempotent-check.md`

- [ ] **Step 1: 写 PRD**

内容（完整）：

```markdown
# PRD: brain-deploy.sh 幂等检查

## 问题
scripts/brain-deploy.sh 无条件 `docker compose up -d`，即使 image SHA 未变也 recreate 容器，中断 Brain 长跑 Initiative（SIGTERM）。每 3 小时一次，P0。

## 方案
在 `[7/8]` 的 `docker compose up -d` 前加 image SHA 比对，相同则 `DEPLOY_SUCCESS=true; exit 0`。

## 成功标准
- scripts/brain-deploy.sh 包含 `docker inspect cecelia-node-brain --format '{{.Image}}'`
- 包含 SHA 比较分支 `CURRENT_IMG == TARGET_IMG` 并 `exit 0`
- 未修改 launchd 模式代码块
```

- [ ] **Step 2: 写 DoD**

内容（完整）：

```markdown
# DoD: brain-deploy.sh 幂等检查

- [ ] [ARTIFACT] brain-deploy.sh 已加 image SHA 比对
  Test: manual:node -e "const c=require('fs').readFileSync('scripts/brain-deploy.sh','utf8');if(!c.includes(\"docker inspect cecelia-node-brain --format\"))process.exit(1)"

- [ ] [BEHAVIOR] 同 SHA 跳过分支存在（CURRENT_IMG == TARGET_IMG 触发 exit 0）
  Test: manual:node -e "const c=require('fs').readFileSync('scripts/brain-deploy.sh','utf8');if(!c.includes('CURRENT_IMG') || !c.includes('TARGET_IMG'))process.exit(1);if(!/CURRENT_IMG.*==.*TARGET_IMG/.test(c))process.exit(1);if(!c.includes('DEPLOY_SUCCESS=true'))process.exit(1)"

- [ ] [ARTIFACT] Learning 文档存在
  Test: manual:node -e "require('fs').accessSync('docs/learnings/cp-0424122436-brain-deploy-idempotent-check.md')"
```

- [ ] **Step 3: Commit**

```bash
git add prd-cp-0424122436-brain-deploy-idempotent-check.md .dod-cp-0424122436-brain-deploy-idempotent-check.md
git commit -m "docs(prd): brain-deploy.sh 幂等检查 PRD+DoD"
```

---

## Task 2: 修改 brain-deploy.sh 加幂等检查

**Files:**
- Modify: `scripts/brain-deploy.sh` （在行 135 `echo "[7/8] Starting container..."` 后、行 136 `if [[ "$DRY_RUN" == true ]]` 前插入）

- [ ] **Step 1: 插入幂等检查**

在 `scripts/brain-deploy.sh` 行 135 之后、行 136 之前（即 `echo "[7/8] Starting container..."` 这行后面）用 Edit 工具把这段：

```bash
    # 7. Stop old container + start new one
    echo "[7/8] Starting container..."
    if [[ "$DRY_RUN" == true ]]; then
```

替换为：

```bash
    # 7. Stop old container + start new one
    echo "[7/8] Starting container..."

    # 幂等检查：容器已在目标 image SHA 则跳过 recreate（避免 SIGTERM 中断长跑 Initiative）
    CURRENT_IMG=$(docker inspect cecelia-node-brain --format '{{.Image}}' 2>/dev/null || echo "")
    TARGET_IMG=$(docker inspect "cecelia-brain:${VERSION}" --format '{{.Id}}' 2>/dev/null || echo "")
    if [[ "$DRY_RUN" == false && -n "$CURRENT_IMG" && -n "$TARGET_IMG" && "$CURRENT_IMG" == "$TARGET_IMG" ]]; then
        echo "  [skip] 容器已在 v${VERSION}（image SHA 一致），跳过 recreate"
        DEPLOY_SUCCESS=true
        exit 0
    fi

    if [[ "$DRY_RUN" == true ]]; then
```

- [ ] **Step 2: 跑 DoD 验证**

```bash
node -e "const c=require('fs').readFileSync('scripts/brain-deploy.sh','utf8');if(!c.includes(\"docker inspect cecelia-node-brain --format\"))process.exit(1);if(!/CURRENT_IMG.*==.*TARGET_IMG/.test(c))process.exit(1);if(!c.includes('DEPLOY_SUCCESS=true'))process.exit(1);console.log('PASS')"
```

Expected: `PASS`

- [ ] **Step 3: Commit**

```bash
git add scripts/brain-deploy.sh
git commit -m "fix(brain): brain-deploy.sh 加 image SHA 幂等检查跳过同版本 recreate"
```

---

## Task 3: 写 Learning 文档

**Files:**
- Create: `docs/learnings/cp-0424122436-brain-deploy-idempotent-check.md`

- [ ] **Step 1: 写 Learning 内容**

完整内容：

```markdown
# Learning: brain-deploy.sh 幂等检查

## 现象
Brain 容器每 3 小时左右被 recreate 一次，长跑 Initiative（含多分钟子任务）被 SIGTERM 中断。

## 根本原因
`scripts/brain-deploy.sh` 在 Docker 模式下无条件执行 `docker compose up -d`。`/dev cleanup` 合并 Brain PR 后会自动跑 deploy，即使镜像 SHA 未变（build 缓存命中相同 layer），compose up 仍会触发容器 recreate，发 SIGTERM。

叠加了"每合并一次 Brain PR 就触发 deploy"的自动化路径，导致每几个 PR 合并周期就炸一次容器。

## 修复
在 `docker compose up -d` 前加 image SHA 比对：`docker inspect cecelia-node-brain --format '{{.Image}}'` 对比 `docker inspect cecelia-brain:${VERSION} --format '{{.Id}}'`，相同则设 `DEPLOY_SUCCESS=true` 后 `exit 0`。

## 下次预防

- [ ] 所有 deploy 脚本在调用会导致容器 recreate 的命令前，必须有幂等检查（image SHA / config hash）
- [ ] 不要依赖 docker compose 的"幂等"错觉——即使镜像未变，显式 `up -d` 仍会触发 recreate
- [ ] 长跑任务要考虑部署中断，但更根本的修复是让部署本身具备幂等性
```

- [ ] **Step 2: Commit**

```bash
git add docs/learnings/cp-0424122436-brain-deploy-idempotent-check.md
git commit -m "docs(learning): brain-deploy.sh 幂等检查"
```

---

## Task 4: 全量 DoD 验证

- [ ] **Step 1: 跑全部 DoD 检查命令**

```bash
node -e "const c=require('fs').readFileSync('scripts/brain-deploy.sh','utf8');if(!c.includes(\"docker inspect cecelia-node-brain --format\"))process.exit(1)" && \
node -e "const c=require('fs').readFileSync('scripts/brain-deploy.sh','utf8');if(!c.includes('CURRENT_IMG') || !c.includes('TARGET_IMG'))process.exit(1);if(!/CURRENT_IMG.*==.*TARGET_IMG/.test(c))process.exit(1);if(!c.includes('DEPLOY_SUCCESS=true'))process.exit(1)" && \
node -e "require('fs').accessSync('docs/learnings/cp-0424122436-brain-deploy-idempotent-check.md')" && \
echo "ALL PASS"
```

Expected: `ALL PASS`

- [ ] **Step 2: 把 DoD 里的 `[ ]` 改成 `[x]`**

Edit `.dod-cp-0424122436-brain-deploy-idempotent-check.md`，把所有 `- [ ]` 改 `- [x]`。

- [ ] **Step 3: Commit**

```bash
git add .dod-cp-0424122436-brain-deploy-idempotent-check.md
git commit -m "docs(dod): 所有 DoD 项已验证"
```

---

## Self-Review

- **Spec coverage**：✅ Spec 的三个点（image SHA 比对 / `CURRENT_IMG == TARGET_IMG` / launchd 不改）都有对应 task
- **Placeholder scan**：✅ 无 TBD/TODO
- **Type consistency**：✅ 变量名 `CURRENT_IMG` / `TARGET_IMG` / `VERSION` / `DEPLOY_SUCCESS` 全文一致
