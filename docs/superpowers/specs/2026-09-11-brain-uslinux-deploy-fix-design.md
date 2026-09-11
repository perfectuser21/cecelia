# Brain us-vps(Linux) 部署适配 — 设计

## 背景

Cecelia Brain 的生产部署链条（`scripts/deploy-local.sh` → `scripts/brain-deploy.sh`）从建立起主要在 macOS（mmv）上运行和验证。us-vps（Linux）生产环境部署这条链条从未真正跑通过——现役容器 `cecelia-node-brain` 是当年手工 `docker commit` 搬运的产物。

本次调查（详见 `golden_paths` 表 id `199ae170-302e-4a15-b26a-70b10496fda7` 的 proposal_doc）过程中，通过实际读代码核实，发现原始诊断部分有误：真正被 Gate3 调用的活脚本是 `scripts/brain-deploy.sh`，它已经内置了 `DEPLOY_MODE`（docker/launchd）自动探测（第267-274行），us-vps 上 Docker 容器存在必然走 docker 分支，**不会触碰 launchctl**（此前怀疑的 `scripts/brain-docker-up.sh` 其实是无人调用的死代码）。部署失败的 Bark 告警（`scripts/lib/bluegreen.sh` 的 `send_bark`）也早已存在。`scripts/host-disk-sampler.sh` 采样脚本本身已经对非 APFS/非 macOS 环境有优雅降级（`df -k /System/Volumes/Data` 失败会回退到 `df -k /`；`diskutil` 缺失时 `apfs_unallocated_bytes` 回退等于 `data_avail_bytes`），**无需改代码**——Preview CI 在 us-vps 上系统性红的唯一原因是没人在 us-vps 装 crontab 定时跑它（这本来就是"部署方手工安装"的既有惯例，mmv 也是这样装的，不是自动化范围）。

真正卡住部署的是运行时环境配置错误：us-vps 容器的 `REPO_ROOT` 环境变量指向一个 macOS 路径（`/Users/administrator/perfect21/cecelia-deploy-main`），容器内该路径不存在，且容器只挂载了 `docker.sock`。这个环境配置修复是运维动作（已有拍板决策：先打基线镜像 tag → 影子部署验证 → 人工手动切换生产），**不在本次代码改动范围内**。

## 本次改动范围（收窄后）

修好"下一次有人真的走这条部署链条时，它在 Linux 上能跑对"这件事需要的**代码**只有两处：

1. **`docker-compose.us-vps.yml`（新文件）**：`docker-compose.yml` 里 `node-brain` 服务的 Linux 版本。**只砍掉账号绑定类挂载**（`.claude-account1~3`、`.codex-team1~5`、`.grok`——这几个在 Linux 上源路径本来就不存在，且违反「引擎-机器绑定铁律」：Claude/Codex 只在 mmv 跑）。**其余全部保留**，只是把宿主路径从 `/Users/administrator/...` 改指 Linux 路径（`/root/cecelia` 等）：`docker.sock`、`.credentials`、skills（`packages/workflows`，只读）、`packages/config`、`HEARTBEAT.md`、`workers.config.json`、worktree 目录、`content-output`/`claude-output`、`.ssh`、`.gitconfig`/`.config/gh`、主仓库 + REPO_ROOT、时区。这是决策「Brain us-vps(Linux)部署-compose策略」「...凭据挂载裁剪」及其细化决策「...凭据挂载裁剪范围细化」的落地——细化决策纠正了最初"只留DB凭据+skills+REPO_ROOT"这个过窄的 allowlist，因为 `docker.sock`/git配置/`HEARTBEAT.md` 等是 Brain 自身运行必需的功能性挂载，跟账号绑定无关，严格砍掉会让 us-vps 上部分现有 API 静默失败。
2. **`scripts/brain-deploy.sh` 的 compose 文件选择**：docker 模式分支目前硬编码 `-f "$ROOT_DIR/docker-compose.yml"`（第441行等3处）。加一段基于 `uname -s` 的自动选择——Linux 用 `docker-compose.us-vps.yml`，其余（Darwin）用现有 `docker-compose.yml`；允许 `COMPOSE_FILE` 环境变量显式覆盖（方便测试/未来手动指定）。**不改 `DEPLOY_MODE` 探测逻辑**（docker/launchd 判断本身没问题）。

**不做**（原提案的误诊部分，已用代码证据核实纠正）：
- 不改 `brain-docker-up.sh`（死代码，无调用点）
- 不新建部署失败告警逻辑（`send_bark` 已存在且被广泛调用）
- 不改 `host-disk-sampler.sh`（已经优雅降级到 Linux）；us-vps 装 crontab 是 PR 描述里给出安装说明的运维动作，不是代码改动

## 方案取舍：compose 文件怎么选

考虑过三种方式：

1. **`uname -s` 自动探测**（采用）：`brain-deploy.sh` 自己判断跑在什么系统上，选对应的 compose 文件。零配置，跟脚本已有的 `DEPLOY_MODE` 自动探测（docker/launchd）风格一致。
2. 复用现有 `ENV_REGION` 变量做选择：否决——`ENV_REGION` 已经有明确语义（作为运行时 env 传进容器做区域标记，见第17、321、334、439行），拿来兼做"选哪份文件"会把两个不相关的概念糅在一个变量里，后续任何人改 `ENV_REGION` 的默认值都可能无意间改到 compose 选择，脆弱。
3. `docker-compose.yml` + override 合并文件（`-f a.yml -f b.yml`）：否决——用户已经在决策「compose策略」里明确拍板"为 Linux 单建 docker-compose.us-vps.yml，与 macOS 的 docker-compose.yml 互不牵连"，不是参数化合并方案，直接遵循既有决策。

## 测试策略

四档中属于 **integration（脚本级）+ 结构断言**，风格延续本仓库既有的 `packages/brain/scripts/smoke/factory-f2-deploy-smoke.sh`（该文件本身就是 F2 部署闭环的 smoke 守卫，本次改动挂靠同一条 Golden Path 的同一个守卫文件，不新开一个）：

1. `docker-compose.us-vps.yml` 存在 + `docker compose -f docker-compose.us-vps.yml config` 能无错解析（验证 YAML 语法/引用合法）
2. 解析后的配置文本 grep 断言：**不含** `claude-account`、`codex-team`、`.grok`；**含** REPO_ROOT 对应的卷（`/root/cecelia`）、`docker.sock`、`.credentials`、`packages/workflows`
3. `brain-deploy.sh --dry-run`：`COMPOSE_FILE` 未显式指定、模拟 `uname -s` 返回 `Linux` 时，dry-run 输出引用 `docker-compose.us-vps.yml`；模拟返回 `Darwin`（或不设置，默认路径）时输出仍引用 `docker-compose.yml`（防回归，macOS 现有行为不能变）
4. 不做端到端真实 `docker compose up`（会真的起容器，不适合 CI 沙箱，也超出本次范围——真实验证是决策里锁定的"影子部署"人工步骤）

## 边界确认

- 不涉及重启/操作任何生产容器（us-vps 的 `cecelia-node-brain` 保持原状）
- 不涉及 us-vps 主机的实际 crontab/容器配置变更（那是决策锁定的人工手动步骤，PR 描述里给出安装说明供人工执行，不在 CI/自动化范围内）
- `docker-compose.yml`（macOS版）本身不修改，mmv 现有部署流程零回归风险
