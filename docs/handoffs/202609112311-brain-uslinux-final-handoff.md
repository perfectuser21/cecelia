# Handoff — 2026-09-11 23:11 · Brain us-vps(Linux) 部署适配彻底收尾

task_id: unknown（本次 /dev 路径B 未预先注册 Brain task，直接走 engine-worktree 进入实现）
verdict: PASS

## 一句话

Cecelia Brain 在 us-vps(Linux) 上从建立以来第一次真正跑通——不只是代码合并，**生产容器已经两轮真实切换并在生产环境内直接验证过修复生效**。这条 GP 到此收官，唯一遗留是一个已排除跟本次改动无关的独立小问题。

## 完成了什么（done）

### 代码（6个PR，全部合并）
- PR #5274：新增 `docker-compose.us-vps.yml`（Linux专属compose） + `scripts/brain-deploy.sh` 按 `uname -s` 自动选compose文件
- PR #5277：PR #5274 的收尾 handoff 文档
- PR #5278：`docker-compose.us-vps.yml` 改用 `network_mode: host`（us-vps上Postgres只监听127.0.0.1，不对外开放到docker网桥，现役容器一直是host网络模式跑的，原文件误抄了macOS的bridge+端口映射）
- PR #5279：`scripts/brain-deploy.sh` 的 `CECELIA_INTERNAL_ENV_FILE` 硬编码macOS路径改跟 `HOST_HOME` 走；`docker-compose.us-vps.yml` 的 `read_only:true` 改回 `false`（会让fleet worker的SSH控制socket创建失败，现役容器一直是read_only:false在跑）
- PR #5281：`packages/brain/src/harness-worktree.js` 的 `DEFAULT_BASE_REPO` 按平台区分（Linux跟REPO_ROOT走，缺省`/root/cecelia`；macOS保持硬编码不变）；同款修复顺带覆盖 `packages/brain/src/cron/worktree-reaper.js`（同样硬编码过macOS路径，导致这个收割cron在us-vps上永远无东西可收）；配套修了3个被我的修复"跑挂"的既有测试（CI跑在ubuntu-latest上，process.platform==='linux'，硬编码macOS路径的测试断言会失败）+1个production-compose.test.js的过时正则断言；F1步骤3新增GP步骤断言 `tests/gp/f1/step3-worktree-base-repo-platform.test.js`
- PR #5283：`BARK_TOKEN` 从两份compose文件的 `environment:` 段移除（跟 `KERNEL_FLEET_BRIDGE_TOKEN` 曾踩过的同一个坑——environment优先级高于env_file，会把 `.env.docker` 里的真实token静默覆盖成空串），改成只从env_file读

### 生产容器实操（us-vps，两轮真实切换）
1. **第一轮**：打基线镜像tag `cecelia-brain:baseline-20260911-114905` → 停旧容器改名保留（`cecelia-node-brain-old-baseline`） → 用新compose（PR#5274+5278的成果）起新容器 → 健康检查通过 → **直接在生产容器内跑 `loadSkillBundle('capability-controller')` 验证成功**——这是最初卡住整个调查的根因bug，确认解决
2. **第二轮**（发现`harness-worktree.js`这类代码是打包进Docker镜像的，光`git pull`不生效，同 `feedback_brain_pull_before_reload` memory 的教训）：在生产容器内用 `brain-build.sh` 重新build出 `cecelia-brain:1.286.2` 镜像（容器有docker.sock可控host daemon）→ 影子部署验证（15222端口）确认 `DEFAULT_BASE_REPO=/root/cecelia` → 打新基线tag `cecelia-brain:baseline-20260911-pre-1.286.2` → 正式切换 → **生产容器内直接验证 `loadSkillBundle` 和 `DEFAULT_BASE_REPO` 均正确解析**

### 顺手发现并修复的独立bug
- **BARK_TOKEN静默失效**：切换时发现生产容器的 `BARK_TOKEN` 环境变量是空的——排查后发现是compose文件的既有设计缺陷（同KERNEL_FLEET_BRIDGE_TOKEN的坑），**意味着 Bark 告警在此之前很长一段时间实际发不出去，且没有任何报错提示这一点**。已用shell export临时修复现网 + PR#5283正式修复代码
- 清理了us-vps上的docker镜像磁盘占用（删掉 `cecelia-brain:migrate` 和最早的基线tag，按决策J5保留最近2个）

## 没做的 / 明确排除（not_done）

- **一个任务dispatch卡住的独立现象**：task `feef7d3f-c08e-4ee1-acba-a6a4e626edf2`（golden_path_proposal类型，就是本次GP的提案任务）用block→unblock重新排队多次后，`tick_status.last_dispatch` 记录了success但task行本身（execution_attempts/last_attempt_at/updated_at/status）完全不动，一直卡在queued。**已排除跟本次Linux适配相关**（loadSkillBundle/DEFAULT_BASE_REPO都已经用docker exec直接验证过修复生效，不需要靠这个task真正跑完才能证明）。已建issue `dea5237b-f19b-4fe9-b1b5-6aac0a95cb32` 单独追踪，怀疑跟观测到的 `tasks.updated_at` 与 `tick_status` 时间戳之间~7-8小时的系统性偏移有关（未证实，猜测是Brain进程与DB两端时区设置不一致）。
- `/root/zenithjoy-skills`、`/root/zenithjoy-skills-dist`、`/root/worktrees`、`/root/content-output` 这几个 `docker-compose.us-vps.yml` 声明的挂载目录，在us-vps上目前是本次临时创建的**空目录占位**——kernel-v1核心功能（skill加载走的是`packages/workflows/skills`，在REPO_ROOT下，不依赖这几个目录）不受影响，但如果未来有功能真的需要这几个目录里的内容（比如relay skill dispatch去mmv跑claude/codex），需要另外决定是clone对应仓库还是确认us-vps确实不需要这条能力（按"引擎-机器绑定铁律"，Claude/Codex只在mmv跑，us-vps大概率真的不需要）
- `read_only: true` 的加固（当前是 `false`，跟原有生产行为一致）留作独立后续工作，需要先给SSH socket创建的路径单独一个可写挂载才能安全加固
- Gate3的自动触发机制本身没有改动（决策J4锁定：首次切换必须人工触发，这次已经完成人工触发，后续Gate3自动部署会不会正确复用这套新配置——严格说还没有被"真实自动触发一次"验证过，只验证过手动执行`brain-deploy.sh --dry-run`和手动docker compose操作）

## 下一步（next_steps）

1. **如果有精力**：调查issue `dea5237b`（task dispatch卡住），建议直接看Brain进程的实时日志（不是查DB字段），追踪dispatcher.js在这个具体task上实际走到哪个分支返回了`dispatched:false`
2. **观察一段时间**：确认Bark告警修复后确实能收到通知（比如故意制造一次部署失败或健康检查失败，看Bark有没有真的推送）
3. **真实场景验证**：下次有人正常合并一个改`packages/brain/**`的PR，观察Gate3自动触发的部署是否真的能在us-vps上端到端跑通（这会是"自动部署链条"第一次被动触发验证，而不是像今晚这样人工手动操作）
4. 确认`/root/zenithjoy-skills`等空目录是否需要真实内容（见上方not_done）
5. 如果`read_only:true`加固有价值，设计SSH socket目录的可写挂载方案

## 数据源（data_sources）

- `golden_paths` 表 id `199ae170-302e-4a15-b26a-70b10496fda7`（完整提案文档 + 最终status_reason）
- `decisions` 表 category=deployment，topic 前缀"Brain us-vps(Linux)部署-"（12条，含逐条决策原因）
- issue `143465ac-c3c5-4ba6-b705-01c0e93b6344`（原始kernel-v1 REPO_ROOT问题，已通过验证应可关闭，需要有internal token权限的人手动操作）
- issue `dea5237b-f19b-4fe9-b1b5-6aac0a95cb32`（新，task dispatch卡住的独立问题）
- 更早的排查记录：`docs/handoffs/202609110943-brain-linux-deploy-pipeline-gap.md`、`docs/handoffs/202609111737-brain-uslinux-deploy-fix.md`
- us-vps现状：`cecelia-node-brain` 容器跑 `cecelia-brain:1.286.2`，基线回滚镜像 `cecelia-brain:baseline-20260911-pre-1.286.2`

## 产物（artifacts）

- PR: #5274, #5277, #5278, #5279, #5281, #5283（perfectuser21/cecelia，全部已合并）
- 相关memory：`brain-linux-deploy-pipeline-gap.md`（完整时间线）、`feedback_main_checkout_never_commit_directly.md`（本次踩的一个commit事故教训）
