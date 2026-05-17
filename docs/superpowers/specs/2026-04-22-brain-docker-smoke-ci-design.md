# Brain Docker Infra CI 保护 + 本机 Smoke 脚本 设计

**日期**: 2026-04-22
**分支**: cp-0422140001-brain-docker-smoke-ci
**Task**: 24951158-521e-4f32-a80a-14594c1ef478

## 背景

PR #2523 把 Brain 迁进 OrbStack Docker 容器后，留下了一个保护盲区：如果有人改 `packages/brain/Dockerfile` / `docker-compose.yml` / `scripts/brain-docker-up.sh`，CI 目前只做 yaml/bash 语法层面校验（DoD level），不会发现"镜像 build 失败"、"容器起不来"、"容器内依赖缺失"这类实质回归。要到 Mac 本机手动切换才能暴露。

这个 Sprint 加两层保护：
1. **A. CI 层**：GitHub Actions Linux runner 能做的事（镜像 build / deps 解析 / compose config），进 CI 主 workflow
2. **C. 本机 smoke 脚本**：macOS 专属内容（host.docker.internal / 绝对路径 mount / launchd 双 scope），放脚本让开发者改这块前手动跑一次

不做 **B. Linux CI 起真容器**：该方案要维护 compose overlay + 相对路径，投入产出比差。

## 目标

- CI 在改 brain/Dockerfile、docker-compose.yml、scripts/brain-docker-*.sh 时自动跑 smoke，3 步有一步挂就 PR 变红
- 开发者改基础设施前能跑 `bash scripts/brain-docker-smoke.sh`，5 分钟内 7 步 pass/fail 报告

## 架构

### A. CI 新增 `docker-infra-smoke` job

挂在 `.github/workflows/ci.yml`，用 `changes` job 条件触发（只在相关文件改动时跑）：

```yaml
docker-infra-smoke:
  if: >-
    github.event_name == 'pull_request' && (
      needs.changes.outputs.brain == 'true' ||
      needs.changes.outputs.compose == 'true'
    )
  needs: [changes]
  runs-on: ubuntu-latest
  timeout-minutes: 8
  steps:
    - uses: actions/checkout@v4
    - name: Build cecelia-brain image
      run: |
        docker build -f packages/brain/Dockerfile -t cecelia-brain:ci .
    - name: Verify key deps resolve inside image
      run: |
        docker run --rm cecelia-brain:ci node -e "require('@langchain/langgraph'); require('@langchain/langgraph-checkpoint-postgres'); require('express'); console.log('ok')"
    - name: Validate docker-compose.yml syntax
      run: |
        # .env.docker 不存在也要 config 通过（用空值）
        : > .env.docker
        docker compose -f docker-compose.yml config > /dev/null
```

### `changes` job 增加 compose/brain path filter

现有 `.github/workflows/ci.yml` 里 `changes` job 用 `dorny/paths-filter` 输出每个子系统是否被改。加一个 `compose` filter：

```yaml
compose:
  - 'docker-compose.yml'
  - 'packages/brain/Dockerfile'
  - 'scripts/brain-docker-*.sh'
  - 'scripts/brain-build.sh'
```

### `ci-passed` 聚合 gate 加 `docker-infra-smoke`

`ci-passed` job 是所有 CI 必过的 aggregator，新 job 加入 needs + check 行。

### C. 本机 `scripts/brain-docker-smoke.sh`

7 步原子脚本，每步独立 pass/fail，末尾统一报告。所有步骤幂等。

```
Step 1: docker build -f packages/brain/Dockerfile .
Step 2: docker run --rm cecelia-brain:ci node -e "require('@langchain/langgraph')"
Step 3: docker compose config（用已有 .env.docker）
Step 4: bash scripts/brain-docker-up.sh (时长 <60s)
Step 5: curl -fs localhost:5221/api/brain/tick/status
Step 6: docker exec cecelia-node-brain sh -c 'docker ps | grep cecelia-node-brain && nc -zv host.docker.internal 5432'
Step 7: bash scripts/brain-docker-down.sh（恢复裸跑）

报告：
  [✓] Step 1: build OK (42s)
  [✓] Step 2: deps OK
  [✗] Step 3: compose config failed: ...
  ...
  Total: 6/7 PASSED
  exit 0 if all pass else exit 1
```

脚本末尾不管 pass/fail 都运行 `brain-docker-down.sh` 保证环境状态恢复（不污染开发环境）。

### 调用场景

- **改 docker-compose.yml / Dockerfile / brain-docker-*.sh 前**（人工触发）：
  - 开发者跑 `bash scripts/brain-docker-smoke.sh`
  - 如果 7 步全 PASS，安心改代码
  - 如果挂了，提示说"当前 main 的 docker infra 已经坏了，先修再开"
- **CI PR 触发**（自动）：
  - 只要 PR 摸了上述文件，CI 自动跑 A 层 3 步
  - 挂了 PR 变红，不能合并

## 组件

### 1. `.github/workflows/ci.yml`（改 3 处）

- `changes` job 的 filter 段加 `compose` 输出
- 新增 `docker-infra-smoke` job（~30 行 YAML）
- `ci-passed` job 的 `needs` 和 `check` 行加 `docker-infra-smoke`

### 2. `scripts/brain-docker-smoke.sh`（新建，~100 行 bash）

- 7 步子函数 `step1_build`、`step2_deps`、... 独立 exit code
- 主流程用数组收集结果，末尾打报告
- `trap 'bash scripts/brain-docker-down.sh' EXIT` 保证退出时回滚

### 3. `README` 或 `scripts/README.md`（改 / 新建）

在仓库 README / 或 scripts 目录加一段说明什么时候用 smoke 脚本。

### 4. DoD 和 Learning（Ship 前写）

## 错误处理

- **Step 1 build 失败**：打印 `docker build` 尾部 30 行，退 1
- **Step 4 up 失败**：down.sh 兜底清现场，打印 `docker logs cecelia-node-brain --tail 30`，退 1
- **Step 5 curl 失败**：容器 healthy 但 HTTP 不通，打印 `docker inspect health`
- **EXIT trap 兜底**：脚本任意位置退出都尝试 brain-docker-down.sh（即使脚本本身挂）

## 数据流

### CI 路径

```
PR push → GitHub Actions → changes job 检测 paths-filter →
  if compose=true: docker-infra-smoke job 排队 →
    checkout → docker build → node require 测试 → compose config →
      3 步 ALL ok → SUCCESS → ci-passed aggregator 通过
      任一 fail → FAILURE → PR 变红
```

### 本机 smoke

```
开发者: bash scripts/brain-docker-smoke.sh
  → 依次跑 7 步
    → 每步 set +e 独立记录 pass/fail
  → 末尾打总结
  → trap EXIT: brain-docker-down.sh 保证现场干净
```

## 范围限定

**在范围内**：
- CI `docker-infra-smoke` job（Linux ubuntu runner）
- 本机 `scripts/brain-docker-smoke.sh`（macOS + OrbStack）
- `ci.yml` 改 changes filter + aggregator
- DoD + Learning

**不在范围内**：
- Linux CI 起真容器 + compose up（需要 compose overlay 工程量大，投产出比低）
- 改 docker-compose.yml 加 override 文件（Sprint 2 再做）
- 覆盖 Kubernetes / 其他容器 runtime（只保 OrbStack + Docker CLI）
- Brain 代码层单元测试（独立 Sprint）

## 成功标准

- **SC-001**: `.github/workflows/ci.yml` 有 `docker-infra-smoke` job
- **SC-002**: `changes` job 有 `compose` output
- **SC-003**: `ci-passed` needs 含 `docker-infra-smoke`
- **SC-004**: `scripts/brain-docker-smoke.sh` 存在，可执行，本机跑完 7 步
- **SC-005**: 本 PR 的 PR CI 里 `docker-infra-smoke` job 绿（因为 PR 会改 compose / script 相关）
- **SC-006**: 反向测试 — 故意破坏 Dockerfile（比如删 `USER root` 那行），CI job 变红（通过手动验证或截图入 Learning）

## 假设

- [ASSUMPTION: Linux runner 上 `docker build` 和 macOS/OrbStack 一致] Docker 镜像 build 是 OCI 标准，多平台一致
- [ASSUMPTION: node:20-alpine 多 arch 镜像存在] Docker Hub 官方镜像 arm64 + amd64 都有
- [ASSUMPTION: `docker compose config` 不需要真的起容器] config 只做 yaml 解析和变量展开
- [ASSUMPTION: `.env.docker` 空文件 compose config 能通过] 我们的 compose 里所有变量都有默认值（`${VAR:-default}`）
- [ASSUMPTION: dorny/paths-filter 现有 changes job 已装] 查 ci.yml 确认过

## 边界情况

- **CI 镜像 build 超时**：timeout-minutes=8 应该够（本机 build 2-3 分钟）
- **brain-docker-smoke.sh 被中断**：`trap EXIT` 兜底 brain-docker-down.sh 恢复裸跑
- **本机 Brain 已经跑在容器里**：smoke Step 4 `brain-docker-up.sh` 脚本会 launchctl unload 再 compose up，幂等，但会重启现有容器（用户接受：smoke 是开发工具不是日常 Health check）
- **CI runner 没有 BuildKit 或 arm64 emulation**：Dockerfile 只用 alpine + 标准工具，无 arm64 specific，兼容

## 预期受影响文件

```
.github/workflows/ci.yml                                 (改：changes filter + 新 job + aggregator)
scripts/brain-docker-smoke.sh                            (新建，可执行)
docs/superpowers/specs/2026-04-22-brain-docker-smoke-ci-design.md  (本文档)
docs/learnings/cp-0422140001-brain-docker-smoke-ci.md    (Ship 时写)
```
