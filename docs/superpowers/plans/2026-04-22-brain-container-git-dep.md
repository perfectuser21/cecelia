# Brain Container Git Dep Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** `packages/brain/Dockerfile` 的 apk add 行加 `git openssh-client ca-certificates`。

**Architecture:** 一行 Dockerfile 改动 + 本机 build + 重启容器 + 冒烟 `which git`。

---

## Task 1: 改 Dockerfile + build + 重启验证

**Files:**
- Modify: `packages/brain/Dockerfile`

- [ ] **Step 1.1: 改 apk add 行**

`packages/brain/Dockerfile` 找到：
```dockerfile
RUN apk add --no-cache curl bash procps tini docker-cli \
 && adduser -D -u 1001 cecelia
```

改为：
```dockerfile
RUN apk add --no-cache curl bash procps tini docker-cli git openssh-client ca-certificates \
 && adduser -D -u 1001 cecelia
```

- [ ] **Step 1.2: 本机 build + stop/rm/up**

```bash
cd /Users/administrator/worktrees/cecelia/brain-container-git-dep
bash scripts/brain-build.sh
# main 仓库同步（Brain 实际 compose 从主仓库路径读）
cp packages/brain/Dockerfile /Users/administrator/perfect21/cecelia/packages/brain/Dockerfile
cd /Users/administrator/perfect21/cecelia
docker stop cecelia-node-brain && docker rm cecelia-node-brain
docker compose up -d node-brain
sleep 10
docker inspect cecelia-node-brain -f '{{.State.Health.Status}}'
```

Expected: 最后一行输出 `healthy`。

- [ ] **Step 1.3: 冒烟 git 存在**

```bash
docker exec cecelia-node-brain which git
docker exec cecelia-node-brain git --version
```

Expected:
```
/usr/bin/git
git version 2.xx.x
```

- [ ] **Step 1.4: 冒烟重跑 Initiative 2303a935 不再 ENOENT**

```bash
# task 刚才已 re-queued，现在触发 tick 让 Brain 再派一次
psql -d cecelia -c "UPDATE tasks SET status='queued', claimed_by=NULL, claimed_at=NULL, payload='{}'::jsonb WHERE id='2303a935-3082-41d9-895e-42551b1c5cc4'"
curl -s -X POST http://localhost:5221/api/brain/tick > /dev/null
sleep 30
# 查 log 有没 spawn git ENOENT
docker logs --since 2m cecelia-node-brain 2>&1 | grep -iE '2303a935' | tail -5
```

Expected: 不再看到 `spawn git ENOENT`。至少能看到 `[harness-initiative-runner] starting task=2303a935...` 后进入 Planner spawn。

- [ ] **Step 1.5: 提交**

```bash
cd /Users/administrator/worktrees/cecelia/brain-container-git-dep
git add packages/brain/Dockerfile
git commit -m "fix(brain-image): apk add git + openssh-client + ca-certificates

PR #2523 Alpine base image 漏装 git → harness-initiative-runner
spawn git ENOENT → Phase A ensureHarnessWorktree 完全跑不了。

加三样：
- git           harness-worktree.js 调 git clone/worktree
- openssh-client 备用 git ssh:// 协议
- ca-certificates HTTPS 证书验证

镜像 size +~20MB 可接受。

Task: b4e92e19-1e11-4044-b5a1-bba9f5f79d0c

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: DoD + Learning

**Files:**
- Modify: `.dod`
- Create: `docs/learnings/cp-0422153400-brain-container-git-dep.md`

- [ ] **Step 2.1: 覆盖 .dod**

写 `.dod`：

```markdown
# DoD — cp-0422153400-brain-container-git-dep

## Artifact

- [x] [ARTIFACT] Dockerfile apk add 行含 git/openssh-client/ca-certificates
  - Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/Dockerfile','utf8');for(const p of ['git','openssh-client','ca-certificates'])if(!c.includes(p))process.exit(1);console.log('ok')"

- [x] [ARTIFACT] 设计 + Learning 已提交
  - Test: manual:node -e "require('fs').accessSync('docs/superpowers/specs/2026-04-22-brain-container-git-dep-design.md');require('fs').accessSync('docs/learnings/cp-0422153400-brain-container-git-dep.md')"

## Behavior

- [x] [BEHAVIOR] 镜像内 git 可用
  - Test: manual:bash -c "docker run --rm cecelia-brain:latest which git | grep -q /usr/bin/git"
```

- [ ] **Step 2.2: 写 Learning**

Create `docs/learnings/cp-0422153400-brain-container-git-dep.md`:

```markdown
# Brain 容器加 git 依赖（2026-04-22）

## 做了什么

`packages/brain/Dockerfile` apk add 行追加 `git openssh-client ca-certificates`。

### 根本原因

Alpine base image 默认 minimal，不含 git/ssh/证书链。PR #2523 迁 Brain 到 Docker 时只装了 HTTP 层（curl）+ 容器交互（docker-cli）+ 进程管理（tini/procps/bash），漏了 git。

Brain 运行时：harness-initiative-runner 的 prep 阶段调 `ensureHarnessWorktree` → `execFile('git', ['clone',...])` → **ENOENT**。Phase A 完全跑不了。

### 下次预防

- [ ] 容器化带 orchestrator 的 daemon，先列 runtime 依赖清单（grep `spawn\|execFile\|execSync` on 业务代码）：git / gh / ssh / docker / curl ... 全部 apk add
- [ ] Alpine 镜像比完整 linux 镜像小但丢了很多工具，运行时依赖必须显式
- [ ] CI smoke 可加一步 `docker run IMAGE which git && which curl && which docker` 一次性验证
- [ ] Learning：#2523 cascade 3 次 silent bug — docker-cli 缺 / cgroup 字段无效 / git 缺。未来迁移先 grep spawn 清单

## 技术要点

- `apk add --no-cache git` 约 17 MB
- `openssh-client` 约 5 MB（git ssh:// 协议备用，我们主用 HTTPS+token 可不强需）
- `ca-certificates` 约 0.3 MB（HTTPS 证书链必需）
- 全量镜像从 496 MB → 约 520 MB

## 冒烟验证

```bash
docker exec cecelia-node-brain which git     # → /usr/bin/git
docker exec cecelia-node-brain git --version # → git version 2.47+
# Initiative 2303a935 Phase A prep 不再 ENOENT
```
```

- [ ] **Step 2.3: 提交**

```bash
cd /Users/administrator/worktrees/cecelia/brain-container-git-dep
git add .dod docs/learnings/cp-0422153400-brain-container-git-dep.md
git commit -m "docs: DoD + Learning for brain-container-git-dep

Task: b4e92e19-1e11-4044-b5a1-bba9f5f79d0c

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

- Spec coverage: SC-001 (which git) → Step 1.3 / SC-002 (Initiative prep 不 ENOENT) → Step 1.4
- Placeholder 无
- 命名一致：`cp-0422153400-brain-container-git-dep`
