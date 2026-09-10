# Design: Brain 部署链改指 us-vps

## 背景

2026-09-10 Cecelia Brain 已从本机 mmv 迁移到 us-vps(100.79.41.61)。排查发现两个叠加问题：

1. `.github/workflows/brain-ci-deploy.yml` 的 Gate3 部署 job 里，`BRAIN_URL` 默认值仍是
   `http://100.71.151.105:5221`（mmv 的 Tailscale IP），没跟着迁移改。
2. 更深一层：本机旧 Docker 容器 `cecelia-node-brain`（restartPolicy=unless-stopped）迁移后
   从未真正停止，一直直接绑定主机端口 `0.0.0.0:5221`，导致负责把本机 5221 转发到 us-vps 的
   launchd socat 代理（`com.cecelia.brain-proxy`）持续 bind 失败。本机 5221 上的所有流量
   （包括这次 Gate3 webhook）实际落在这个连着本机独立 Postgres 的孤岛 Brain 上。

问题 2 已经过用户确认，直接在本机执行止血：`docker stop cecelia-node-brain
cecelia-node-brain-staging`，并验证 socat 代理随后成功绑定并转发到 us-vps
（本机与 us-vps 直连 `/api/brain/health` 返回的 `uptime`/`git_sha`/`tick_stats` 已完全一致）。

本 spec 只覆盖还没做的两件事：CI 配置修复 + 防复发的本机守卫。

## 范围

**做**：
1. 修 `.github/workflows/brain-ci-deploy.yml`，`BRAIN_URL` 默认值改指 us-vps 直连 IP，
   不再依赖本机代理这层（哪怕本机代理再挂一次，部署也不会误打到本机）。
2. 加一条 CI 回归测试，断言该 workflow 文件里不再出现旧 IP、且默认值确实是 us-vps IP。
3. 加一个本机 launchd 守卫，定期确认 5221 端口的监听进程是 socat 而不是被杂散容器抢占，
   异常时 Bark 告警；落地后故意模拟抢占场景验证真的会报警。

**不做**：
- 不重新设计部署机制本身（HTTP webhook → deploy-local.sh 的架构不变）。
- 不处理"本机迁移期间是否有需要合并回 us-vps 的分裂数据"——已核对确认没有产生新任务数据，无需处理。
- 守卫脚本不进 cecelia repo（沿用 `~/bin/pf-guard.sh` 等既有本机运维脚本惯例）。

## 组件与实现

### 1. CI 配置修复

文件：`.github/workflows/brain-ci-deploy.yml`

两处 `env.BRAIN_URL`（`deploy` job 和 `on_deploy_failure` job）：
```yaml
BRAIN_URL: ${{ secrets.BRAIN_DEPLOY_URL || 'http://100.79.41.61:5221' }}
```

### 2. 回归测试（进 repo）

新文件：`scripts/ci/__tests__/brain-deploy-url-points-to-us-vps.test.sh`

仿照现有 `scripts/ci/__tests__/assert-deploy-effect.test.sh` 的 shell test 写法：
- 断言 `.github/workflows/brain-ci-deploy.yml` 中不出现字符串 `100.71.151.105`
- 断言两处 `BRAIN_URL` 默认值都包含 `100.79.41.61`

这是纯文本断言，不需要起容器/网络，CI 秒级跑完，防止未来"迁移"时又悄悄改回本机地址。

### 3. 本机端口占用守卫（不进 repo）

新文件：`~/bin/brain-port-guard.sh` + `~/Library/LaunchAgents/com.cecelia.brain-port-guard.plist`

逻辑：
- `lsof -iTCP:5221 -sTCP:LISTEN -n -P` 找到监听进程的 COMMAND 列
- 期望值为 `socat1`（socat 的实际进程名，已在本机验证）
- 不是 → 认为被抢占，调用现有 Bark 告警机制（复用 `~/.credentials/bark.env`）
- 是 → 静默退出

launchd 配置：`StartInterval: 300`（5 分钟，与现有 `pf-guard.sh` 频率一致）

**Proven-to-fire 验证步骤**（落地后手动执行一次，不留在自动化里）：
1. 临时起一个占用 5221 的假进程（如 `nc -l 5221` 或一个临时 docker 容器）
2. 手动跑一次 `brain-port-guard.sh`，确认真的触发 Bark 告警
3. 清理假进程，确认恢复静默

## 测试策略

- **CI test（逻辑接缝）**：`brain-deploy-url-points-to-us-vps.test.sh`，走 repo 现有 CI，push 就跑。
- **本机验证（环境接缝）**：手动模拟端口抢占，亲眼看到告警触发，不是自动化 CI 覆盖的范围。
- 不需要端到端起 Brain 服务验证部署——`deploy-local.sh` 本身的行为不在本次改动范围内。

## 验收标准

- [ ] `brain-ci-deploy.yml` 两处 BRAIN_URL 默认值改为 `100.79.41.61`
- [ ] 新增 CI 回归测试并通过
- [ ] 本机守卫脚本 + launchd 落地，proven-to-fire 验证通过一次
- [ ] PR CI 全绿，走 cp-* 分支正常合并
