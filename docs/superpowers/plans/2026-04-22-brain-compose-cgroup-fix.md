# Brain Compose cgroup Fix Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** 改 `docker-compose.yml` node-brain 加顶层 `mem_limit`/`mem_reservation`/`cpus`，让 cgroup 限额在 compose standalone 模式生效。

**Architecture:** 在现有 `deploy:` 块前加 3 行顶层字段。保留 `deploy.resources`（swarm 兼容）。`brain-docker-up.sh` 里改加 `--force-recreate` 确保容器重建（不然 compose 不会感知 config 变化）。

**Tech Stack:** docker-compose v2, YAML。

---

## Task 1: 改 docker-compose.yml 加顶层 cgroup 字段

**Files:**
- Modify: `docker-compose.yml` (node-brain service)

- [ ] **Step 1.1: 改 compose**

在 `docker-compose.yml` node-brain service 找到：
```yaml
    deploy:
      resources:
        limits:
          memory: 1G
          cpus: '2'
        reservations:
          memory: 512M
    restart: unless-stopped
```

改为（在 `deploy:` 前加三行）：
```yaml
    # compose standalone cgroup 限额（deploy.resources 只 swarm 生效）
    mem_limit: 1g
    mem_reservation: 512m
    cpus: 2.0
    deploy:
      resources:
        limits:
          memory: 1G
          cpus: '2'
        reservations:
          memory: 512M
    restart: unless-stopped
```

- [ ] **Step 1.2: 校验 yaml + compose config**

```bash
cd /Users/administrator/worktrees/cecelia/brain-compose-cgroup-fix
: > .env.docker 2>/dev/null || true
docker compose -f docker-compose.yml config > /dev/null && echo "✅ compose config OK"
```

Expected: 输出 `✅ compose config OK`。

- [ ] **Step 1.3: 提交**

```bash
git add docker-compose.yml
git commit -m "fix(compose): node-brain cgroup 限额生效（顶层 mem_limit/cpus）

deploy.resources.limits 只在 Docker Swarm 模式生效，
compose standalone 模式完全忽略 → Brain 容器实际无 cgroup 限额
（docker inspect Memory: 0 bytes / NanoCpus: 0）。

加顶层字段 mem_limit/mem_reservation/cpus，这是 compose standalone 标准字段。
保留 deploy.resources 块供未来 swarm 兼容。

Task: 30d0fc90-05e5-406f-a69f-e369896f69bd

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: 改 brain-docker-up.sh 加 --force-recreate

**Files:**
- Modify: `scripts/brain-docker-up.sh`

- [ ] **Step 2.1: 改 docker-compose up 行**

在 `scripts/brain-docker-up.sh` 找到：
```bash
docker-compose up -d node-brain
```

改为：
```bash
# --force-recreate: compose 配置改动后强制重建容器（不然保留旧 cgroup）
docker-compose up -d --force-recreate node-brain
```

- [ ] **Step 2.2: bash -n 校验**

```bash
bash -n /Users/administrator/worktrees/cecelia/brain-compose-cgroup-fix/scripts/brain-docker-up.sh && echo "✅ 语法 OK"
```

- [ ] **Step 2.3: 提交**

```bash
cd /Users/administrator/worktrees/cecelia/brain-compose-cgroup-fix
git add scripts/brain-docker-up.sh
git commit -m "fix(scripts): brain-docker-up.sh 加 --force-recreate

docker-compose up 对已存在的容器默认复用，即使 compose 配置改过。
用户改 mem_limit 后跑 up 脚本不会生效 → 加 --force-recreate 强制重建。

Task: 30d0fc90-05e5-406f-a69f-e369896f69bd

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: 本机应用 + 验证

**Files:** (只执行，不改文件)

- [ ] **Step 3.1: 执行 up 脚本（会 force-recreate 生效新配置）**

```bash
cd /Users/administrator/perfect21/cecelia
# 先把本 worktree 的 compose 拷到 main（本机 Brain 容器已经在跑，要用新配置重建）
cp /Users/administrator/worktrees/cecelia/brain-compose-cgroup-fix/docker-compose.yml /Users/administrator/perfect21/cecelia/docker-compose.yml
bash scripts/brain-docker-up.sh
```

Expected: "✅ Brain 容器 healthy (Ns)"

- [ ] **Step 3.2: 验证 cgroup 限额生效**

```bash
docker inspect cecelia-node-brain -f 'Memory: {{.HostConfig.Memory}} bytes  NanoCpus: {{.HostConfig.NanoCpus}}'
```

Expected:
```
Memory: 1073741824 bytes  NanoCpus: 2000000000
```
（1 GB = 1073741824, 2 CPUs = 2000000000）

- [ ] **Step 3.3: 健康检查**

```bash
curl -fs http://localhost:5221/api/brain/tick/status | head -c 100
```

Expected: JSON 含 `"enabled":true`。

- [ ] **Step 3.4: docker stats 显示新 limit**

```bash
docker stats --no-stream cecelia-node-brain --format 'MEM: {{.MemUsage}}'
```

Expected: `MEM: ... / 1GiB`（不再是 5.842GiB）

- [ ] **Step 3.5: 不需要 commit（执行步骤无文件改动）**

---

## Task 4: DoD + Learning

**Files:**
- Modify: `.dod`
- Create: `docs/learnings/cp-0422152028-brain-compose-cgroup-fix.md`

- [ ] **Step 4.1: 覆盖 .dod**

写 `.dod`（可能有上个分支残留）：

```markdown
# DoD — cp-0422152028-brain-compose-cgroup-fix

## Artifact

- [x] [ARTIFACT] docker-compose.yml 加顶层 mem_limit/mem_reservation/cpus
  - Test: manual:node -e "const c=require('fs').readFileSync('docker-compose.yml','utf8');for(const f of ['mem_limit:','mem_reservation:','cpus: 2.0'])if(!c.includes(f))process.exit(1);console.log('ok')"

- [x] [ARTIFACT] brain-docker-up.sh 加 --force-recreate
  - Test: manual:node -e "const c=require('fs').readFileSync('scripts/brain-docker-up.sh','utf8');if(!c.includes('--force-recreate'))process.exit(1);console.log('ok')"

- [x] [ARTIFACT] 设计 + Learning 已提交
  - Test: manual:node -e "require('fs').accessSync('docs/superpowers/specs/2026-04-22-brain-compose-cgroup-fix-design.md');require('fs').accessSync('docs/learnings/cp-0422152028-brain-compose-cgroup-fix.md')"

## Behavior

- [x] [BEHAVIOR] compose config 合法
  - Test: manual:bash -c "docker compose -f docker-compose.yml config > /dev/null 2>&1"

- [x] [BEHAVIOR] 脚本 bash -n 通过
  - Test: manual:bash -c "bash -n scripts/brain-docker-up.sh"
```

- [ ] **Step 4.2: 写 Learning**

Create `docs/learnings/cp-0422152028-brain-compose-cgroup-fix.md`:

```markdown
# Brain Compose cgroup 限额修复（2026-04-22）

## 做了什么

修 PR #2523 的 silent bug：`docker-compose.yml` 用 `deploy.resources.limits` 设 Brain 容器内存/CPU 限额，但这字段**只在 Docker Swarm 模式生效**，compose standalone 模式被忽略。

加顶层 `mem_limit: 1g` / `mem_reservation: 512m` / `cpus: 2.0`（compose standalone 标准字段）。保留 `deploy.resources` 块供未来 swarm 兼容。

同步改 `brain-docker-up.sh` 加 `--force-recreate`，因为 `docker-compose up` 对已存在容器默认复用旧配置。

### 根本原因

Docker 社区长期的配置陷阱：
- `deploy.*` 是 Docker Swarm (v3+) 的字段，compose standalone 启动忽略
- compose standalone 要用 `mem_limit` / `cpus` / `mem_reservation` 顶层字段（compose v2 新版文档说这些"deprecated"但实际仍是 standalone 唯一有效方式）

PR #2523 抄了 Linux VPS 上的 swarm 风格 compose，在本机 compose standalone 下 limit 字段静默失效。没有任何警告。

### 下次预防

- [ ] compose 加 cgroup 限额后，必须 `docker inspect CONTAINER -f '{{.HostConfig.Memory}}'` 验证非 0
- [ ] compose standalone 用 `mem_limit` / `cpus` / `mem_reservation`，swarm 才用 `deploy.resources`
- [ ] 两边都写保证兼容，但文档说明 standalone 读哪个
- [ ] `docker-compose up` 对已存在容器默认复用，配置改过必须加 `--force-recreate`

## 技术要点

- `mem_limit: 1g` 格式（小写 g）= 1 GB = 1073741824 bytes
- `cpus: 2.0` 是浮点，对应 `NanoCpus: 2000000000`
- docker inspect 里 `HostConfig.Memory: 0` = 无限额（用整个宿主可用）
- OrbStack 下"宿主可用"= Linux VM 总量 = 5.84 GB
- `docker-compose up --force-recreate` 会停旧容器 + 起新容器（同名），数据卷保留

## 冒烟验证

```bash
# 1. compose config 合法
docker compose -f docker-compose.yml config > /dev/null

# 2. 应用 + 验证 cgroup
bash scripts/brain-docker-up.sh
docker inspect cecelia-node-brain -f 'Memory: {{.HostConfig.Memory}}'
# Expected: Memory: 1073741824

# 3. docker stats 显示新 limit
docker stats --no-stream cecelia-node-brain --format '{{.MemUsage}}'
# Expected: ...MiB / 1GiB
```
```

- [ ] **Step 4.3: 提交**

```bash
cd /Users/administrator/worktrees/cecelia/brain-compose-cgroup-fix
git add .dod docs/learnings/cp-0422152028-brain-compose-cgroup-fix.md
git commit -m "docs: DoD + Learning for brain-compose-cgroup-fix

Task: 30d0fc90-05e5-406f-a69f-e369896f69bd

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec 覆盖**：全部 3 项需求都有对应 Task（compose 改、脚本改、验证）。
**Placeholder**：无。
**命名一致**：`mem_limit` / `mem_reservation` / `cpus` 在 spec + plan + DoD 一致。
