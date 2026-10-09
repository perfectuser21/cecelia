# 小改动 PrepPRD：Brain us-vps(Linux) 部署适配（compose选择+Linux专属compose+host-disk cron）

## 改什么

1. 新建 `docker-compose.us-vps.yml`：以现有 `docker-compose.yml` 的 `node-brain` 服务为基础裁剪——去掉约24条 `/Users/administrator/...` macOS专属挂载中不需要的部分，只保留：DB凭据挂载、`packages/workflows/skills`（只读，供 kernel-v1 in-process 执行加载 skill）、`REPO_ROOT` 代码卷（指向 us-vps 上 `/root/cecelia`）。不复刻 `.claude-account1~3`、`.codex-team1~5`、`.grok`（决策：Brain us-vps(Linux)部署-凭据挂载裁剪）。
2. `scripts/brain-deploy.sh` 第296-459行 Docker 模式分支加一小段文件选择逻辑：`docker compose -f` 参数根据 `ENV_REGION`（已存在的环境变量，us-vps 部署时应传 `ENV_REGION=us-vps` 或类似值，具体判据在实现时与现有 `ENV_REGION=us` 默认值区分开）选 `docker-compose.yml`（macOS/默认）还是 `docker-compose.us-vps.yml`（Linux）。**不改** DEPLOY_MODE 探测逻辑（docker/launchd 分支本身没问题，问题只在选哪份 compose 文件）。
3. 新增 us-vps 用的 host-disk 采样脚本 + cron/systemd timer 配置：定期（3分钟内）生成 `REPO_ROOT/.runtime/host-disk.json`，修复 `admitPreview()`（`readHostDisk()`）在 us-vps 上系统性红的 Preview CI。

## 为什么改

排查 Deploy Preview CI 系统性红时，顺藤摸瓜发现 Cecelia Brain 的自动部署链条从建立起只为 macOS 设计，us-vps(Linux) 生产环境的部署从未真正跑通——现役容器是当年手工 `docker commit` 搬运的产物，不是走这套自动化部署起来的。GAN 深挖 + 用户拍板了6条相关决策（`decisions`表 category=deployment，topic前缀"Brain us-vps(Linux)部署-"）。

**关键修正**（本次 /dev 上下文核实代码后发现，原提案部分技术细节有误，已修正）：原以为要改的 `scripts/brain-docker-up.sh`（含 `launchctl unload/load`）其实是**死代码**——只有孤儿 worktree 和一个 smoke 脚本引用，早已退出实际部署链路。真正被 Gate3 调用的活脚本 `scripts/brain-deploy.sh` 已经会自动探测 `DEPLOY_MODE`（`docker` vs `launchd`，第267-274行），us-vps 上 Docker 正常、容器存在，必然走 docker 分支，**根本不会碰 launchctl**。部署失败的 Bark 告警（`scripts/lib/bluegreen.sh` 的 `send_bark`）也早已存在，无需新建。真正缺的只是：①一份 Linux 专属的 compose 文件 ②brain-deploy.sh 选哪份文件的逻辑 ③host-disk cron。

## 关联上下文

- Journey/Ability：工厂价值流(VS_FACTORY) · F2 部署闭环（journey_id `2fa4d085-1451-4f3f-8fa1-b6d4bacdb1b6`）
- Golden Path 提案：`golden_paths` 表 id `199ae170-302e-4a15-b26a-70b10496fda7`（`proposal_doc` 字段有完整背景，含11个Challenger缺口核销记录）
- 历史决策：`decisions` 表 category=deployment，topic 前缀"Brain us-vps(Linux)部署-"，共6条（compose策略/凭据裁剪/上线安全网/首次切换触发方式/回滚镜像清理/部署锁异常释放）
- 关联 Issue：`143465ac-c3c5-4ba6-b705-01c0e93b6344`（us-vps Brain容器REPO_ROOT指向macOS路径导致kernel-v1任务100%失败——本PR的compose修复是该issue的前置修复的一部分，但**本PR只改代码，不重启生产容器**，issue的实际验证要等人工手动切换生产那一步（决策：首次切换触发方式=人工手动）完成后才能关闭）

## 影响范围

- 只新增/改动仓库内文件（`docker-compose.us-vps.yml` 新建、`scripts/brain-deploy.sh` 小改、新增 host-disk 采样脚本+cron配置），**不触碰任何正在运行的生产容器**。
- `docker-compose.yml`（macOS版）本身不改，现有 mmv 部署流程零影响。
- `brain-deploy.sh` 的改动是纯增量分支选择（加一个 `if`），不改变现有 macOS/docker 默认路径行为。

## 验收标准

- [ ] `docker-compose.us-vps.yml` 存在，`node-brain` 服务的 `volumes` 只含 REPO_ROOT代码卷 + DB凭据 + skills(只读)，grep 确认不含 `claude-account`/`codex-team`/`grok`
- [ ] `scripts/brain-deploy.sh` 新增的文件选择逻辑有对应测试或 `--dry-run` 验证：`ENV_REGION` 走 us-vps 分支时 dry-run 输出引用 `docker-compose.us-vps.yml`，默认分支仍引用 `docker-compose.yml`（不回归 macOS 路径）
- [ ] host-disk 采样脚本手动执行一次能产出符合 `admitPreview()`/`readHostDisk()` 期望格式的 `.runtime/host-disk.json`
- [ ] CI 全绿
