# Handoff — 2026-09-11 17:37 · Brain us-vps(Linux) 部署适配基础（代码部分已合并）

task_id: unknown（本次 /dev 路径B 未预先注册 Brain task，直接走 engine-worktree 进入实现）
verdict: PASS
PR: https://github.com/perfectuser21/cecelia/pull/5274（已合并，merge commit d181af8f5ceb5d5311618b0478559e5e954c59e3）

## 一句话

给 Cecelia Brain 在 us-vps(Linux) 上真正跑通部署链条打下了代码基础——新增 `docker-compose.us-vps.yml` + `scripts/brain-deploy.sh` 按 `uname -s` 自动选 compose 文件，**但 us-vps 现役生产容器本身还没有被真正切换**，这一步仍需人工操作。

## 完成了什么（done）

1. 新建 `docker-compose.us-vps.yml`：`node-brain` 服务的 Linux 版。只砍账号绑定类挂载（`.claude-account1~3`/`.codex-team1~5`/`.grok`），其余全部保留，宿主路径改指 `/root/...`，`REPO_ROOT=/root/cecelia`，加 `extra_hosts: host.docker.internal:host-gateway`（纯 Linux Docker 不像 OrbStack 原生解析这个域名）。
2. `scripts/brain-deploy.sh`：docker 模式分支按 `uname -s` 自动选 compose 文件（Linux→新文件，其余→原文件），允许 `COMPOSE_FILE` env 覆盖，5 处硬编码统一替换。不改 `DEPLOY_MODE`（docker/launchd）探测逻辑。
3. `packages/brain/scripts/smoke/factory-f2-deploy-smoke.sh`（F2 部署闭环既有守卫）追加 8 条断言，全绿。
4. 过程中修正了一个自己的测试 bug：CI 跑在 `ubuntu-latest`（Linux）上时，"未覆盖 COMPOSE_FILE 默认应该不选 Linux 文件"这条断言在 CI 上必然误判——Linux CI 机默认选中 us-vps 文件才是对的（功能本意），断言改成跟着 `uname -s` 走。

## 没做的 / 明确排除（not_done）

- **没有改动 us-vps 现役生产容器**——现役容器 `cecelia-node-brain` 的 `REPO_ROOT`/挂载仍是错的（指向 `/Users/administrator/...` macOS 路径，容器内不存在）。这个 PR 只是让代码"知道该用哪份 compose"，真正让 us-vps 用上新 compose 文件、切换生产容器，仍需按已拍板的决策走：先打基线镜像 tag → 影子部署验证 → 人工手动切换（decisions 表 category=deployment，共 8 条，topic 前缀"Brain us-vps(Linux)部署-"）
- 没有改 `scripts/brain-docker-up.sh`（核实是死代码，无调用点）
- 没有新增部署失败告警（`scripts/lib/bluegreen.sh` 的 `send_bark` 已存在且广泛调用）
- 没有改 `scripts/host-disk-sampler.sh`（读代码确认已对非 macOS 环境优雅降级）
- 没有配置 us-vps 的 host-disk cron（这本来就是"部署方手工安装"的既有惯例，不是自动化范围）
- 没有处理 issue `143465ac-c3c5-4ba6-b705-01c0e93b6344`（kernel-v1 in-process 任务在 us-vps 上因 REPO_ROOT 配置错误 100% 失败）——这个 issue 要等 us-vps 容器真正切换到新配置后才能验证是否连带修好，目前仍 open

## 下一步（next_steps）

1. 需要人工在 us-vps 上执行：①`docker commit` 给现役容器打基线镜像 tag（回滚锚点）②同机不同端口起影子容器，用新 compose 文件走一遍完整部署流程验证 ③确认无误后人工手动切换生产 5221 端口的真实容器
2. 影子部署验证时需要确认 `/root/zenithjoy-skills`、`/root/zenithjoy-skills-dist` 这两个仓库是否已经 clone 到 us-vps（`docker-compose.us-vps.yml` 声明了这两个挂载，但没有验证 us-vps 主机上是否真的存在这两个目录——如果不存在需要先 clone）
3. 生产切换完成后，验证 issue `143465ac-c3c5-4ba6-b705-01c0e93b6344` 是否随之解决（重新派发一个 `golden_path_proposal` 任务测试 kernel-v1 skill 加载是否不再报错），解决则关闭该 issue
4. 完整背景、11 个 Challenger 缺口的核销记录见 `golden_paths` 表 id `199ae170-302e-4a15-b26a-70b10496fda7` 的 `proposal_doc` 字段

## 数据源（data_sources）

- `golden_paths` 表 id `199ae170-302e-4a15-b26a-70b10496fda7`（完整提案文档）
- `decisions` 表 category=deployment，topic 前缀"Brain us-vps(Linux)部署-"（8条）
- issue `143465ac-c3c5-4ba6-b705-01c0e93b6344`
- 更早的排查记录：`docs/handoffs/202609110943-brain-linux-deploy-pipeline-gap.md`

## 产物（artifacts）

- PR: https://github.com/perfectuser21/cecelia/pull/5274
- branch: cp-0911161209-brain-uslinux-deploy-fix（已删除，已 squash merge）
- 设计文档: `docs/superpowers/specs/2026-09-11-brain-uslinux-deploy-fix-design.md`
- 实现计划: `docs/superpowers/plans/2026-09-11-brain-uslinux-deploy-fix.md`
