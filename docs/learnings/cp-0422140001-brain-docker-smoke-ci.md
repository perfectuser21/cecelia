# Brain Docker Infra CI + Smoke（2026-04-22）

## 做了什么

给 PR #2523 落地的 Brain Docker 化基础设施加两层回归保护：

1. **CI 层**：`.github/workflows/ci.yml` 新增 `docker-infra-smoke` job（ubuntu-latest，timeout 8min）
   - `changes.outputs` 加 `compose` 路径变化检测（docker-compose.yml / Dockerfile / brain-docker-*.sh）
   - 条件触发：`if: needs.changes.outputs.compose == 'true'`
   - 3 步：`docker build` / `node require` 关键 deps / `docker compose config`
   - `ci-passed` aggregator needs + check 加 docker-infra-smoke（skip 不算 fail）

2. **本机 smoke**：`scripts/brain-docker-smoke.sh` 7 步脚本覆盖 macOS 专属
   - Step 1-3：镜像 build / deps / compose config（与 CI 同）
   - Step 4-7：brain-docker-up.sh 切换 / HTTP 健康 / 容器内 docker CLI + host.docker.internal / kill -TERM 1 自愈
   - `trap EXIT` 兜底 `brain-docker-down.sh` 保证脚本失败也回滚裸跑

### 根本原因

PR #2523 落地 Brain Docker 化之后，回归保护只剩两层 yaml/bash -n 层的语法校验。Dockerfile 或 compose.yml 有改动，CI 不会发现"镜像 build 失败"、"容器起不来"、"deps 缺失"这类实质问题，要到 Mac 本机手动跑 brain-docker-up.sh 才暴露。调试成本高、回归发生时难定位。

### 下次预防

- [ ] 容器化新服务的 PR，必须 **同时** 加 CI build smoke（不要依赖"人工本机验证"）
- [ ] CI job 条件触发用现有 `changes.outputs.*` 模式（paths-filter）
- [ ] Linux CI 和 macOS 专属场景分离：CI 只跑 Linux 能稳定跑的，macOS 专属靠本机 smoke 脚本
- [ ] 本机 smoke 脚本必须 `trap EXIT` 兜底回滚，防止脚本失败留残留容器/端口占用
- [ ] ci.yml `ci-passed` aggregator 的 check 函数已支持 skipped 状态（条件触发 job 的合理默认）

## 技术要点

- **changes job paths-filter 模式**：`grep -qE '^(docker-compose\.yml|packages/brain/Dockerfile|scripts/brain-(docker-up|docker-down|build)\.sh)$'`（注意正则锚定行首，避免误匹配）
- **docker compose config 不需容器**：只做 yaml 解析 + 变量展开，CI 轻量
- **空 .env.docker 兼容**：compose 里所有变量用 `${VAR:-default}` fallback，`: > .env.docker` 建空文件够
- **trap EXIT + set +e**：smoke 脚本用 `set +e` 让 step 独立判断 pass/fail，trap EXIT 保证任何退出路径都清场
- **cecelia-brain:ci vs :smoke-ci**：CI 用 `:ci`，本机 smoke 用 `:smoke-ci`，避免和生产 `:latest` 镜像冲突

## 冒烟验证

```bash
# 1. CI 3 步本机模拟（已验证绿）
docker build -f packages/brain/Dockerfile -t cecelia-brain:ci .
docker run --rm cecelia-brain:ci node -e "require('@langchain/langgraph');require('express')"
: > .env.docker && docker compose -f docker-compose.yml config > /dev/null && echo ok

# 2. 本机 smoke 7 步
bash scripts/brain-docker-smoke.sh
# Expected: "Total: 7/7 PASSED" + exit 0

# 3. yaml 语法校验
docker run --rm -v $(pwd)/.github/workflows/ci.yml:/ci.yml:ro python:3.12-alpine sh -c "pip install -q pyyaml && python -c 'import yaml;yaml.safe_load(open(\"/ci.yml\"))'"

# 4. 反向测试（可选）：在 feature branch 上故意把 Dockerfile USER root 删掉，
#    推 PR，CI docker-infra-smoke 应变红（docker build 失败或容器跑不起来）
```
