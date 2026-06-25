# 部署生命周期 阶段1：tag + 留存 + 一键回档（cecelia + zenithjoy）

> 日期：2026-06-25
> 来源：与主理人多轮 brainstorm 收口（staging→打tag→挑tag上线→留旧版回档 模型）
> 范围：**阶段 1 only** —— 给两个 repo 装上"生产 release tag + 旧版留存 + 一键回档"安全网。
> **不含**任何新 staging 环境、staging 自动 E2E、人工放行 gate 重设计、DB migration 工具（全是阶段 2）。

---

## 0. 背景与当前现状（为什么做）

五条部署路径**没有一条**能在生产炸了之后回档。最危险的是 zenithjoy 前端（客户线、`rsync --delete` 一键覆盖生产、零备份）。

| | staging | tag/release | 回档 |
|---|---|---|---|
| cecelia dashboard | ✅(未提交) | ❌ | ❌ promote 成功即 `rm -rf dist.old` |
| cecelia brain | ❌ main=生产 | tag 未用 | ❌ |
| zenithjoy 前端 | ❌ | ❌ | ❌ `rsync --delete` 覆盖生产 |
| zenithjoy 后端 | ❌ | ❌ | ⚠️ 有 `.backups/<时间戳>/` 但无回档脚本 |

**概念基线（已与主理人确认）：**
- monorepo = 一份代码源；拆部署看"几个独立跑起来的产物"。cecelia 真正的部署产物只有 **brain（容器服务）+ dashboard（静态产物）**；harness 跑在 brain 进程内、engine 是 dev 工具，**都不单独部署**。
- **一个 repo = 一个 release 单位**：整 repo 一个版本号，promote 时该 repo 的所有产物**作为一个版本整体进退**。
- **验收 = 打 tag ≠ 上生产**；production 只在 promote 时才动；回档目标 = production 自己发布历史里的上一个 tag（不是 staging）。

---

## 1. 共享生命周期契约（两个 repo 统一语义）

"promote 到生产"从此**强制三件事一起做**（任一失败 → promote 整体失败、生产不动）：

1. **打 tag**：给被部署的 commit 打生产 release tag `prod-<repo>-vN`（N 单调递增）。= "这一版上过生产"的凭据。
2. **存旧版**：把被换下来的**旧生产产物**挪进留存区，**保留最近 5 份，绝不删**。
3. **记指针**：仓库根的 `.production-release`（git 跟踪）记录 `current=<tag>` + 历史列表（追加，不覆盖）。

**回档命令** `rollback.sh [tag]`：
- 无参 → 退到 `.production-release` 历史里**上一个** tag。
- 带 tag → 从留存的 5 份里挑该 tag（不在留存内 → 报错退出，不猜）。
- 动作 = 重新部署该留存产物 + `.production-release` 指针回拨 + 打一条回档审计行。
- 原子：换入失败必须回滚到换入前状态，生产不留半拉子。

**留存份数 N = 5**（超出按 tag 序删最旧）。

---

## 2. Cecelia repo 落地（agent-1）

工作目录：`~/perfect21/cecelia`。涉及 `scripts/promote-dashboard.sh` + 新增 `scripts/rollback-cecelia.sh`。

- **dashboard promote 改造**：`promote-dashboard.sh` 现在 `mv` 换入 live `dist/` 后执行 `rm -rf "${DIST_DIR}.old"`（**这就是回档洞**）。改为：把被换下的旧 `dist/` 挪进 `apps/dashboard/.dist-releases/<tag>/` 留存（不删）；打 tag；写 `.production-release`。`.dist-releases/` 加入 `.gitignore`（产物不进 git）。保留最近 5 份。
- **brain**：brain = `git pull + 重启容器`，回档 = `git checkout <上一个 tag> + 重启容器`。
- **一次 promote** 同时摸 dashboard（换 dist）+ brain（到该版），打**一个**统一 `prod-cecelia-vN` tag。
- **`rollback-cecelia.sh`**：dashboard 换回留存 `<tag>/` + brain checkout 该 tag 重启 + 指针回拨。
- ⚠️ **brain 回档已知约束**：该版若动过 DB schema，光退代码不够。阶段 1 **不建 migration 工具**，只在回档脚本里**检测该 tag 与目标 tag 之间是否有 migration 文件变动**，有则**打印警告 + 要求 `--confirm-db` 显式确认**才继续（把坑标出来，不默默踩）。

## 3. ZenithJoy repo 落地（agent-2）

工作目录：`~/perfect21/zenithjoy`。涉及 `deploy-hk.sh` + `deploy/deploy.sh` + 新增 `rollback.sh`。

- **前端**（`deploy-hk.sh`，现在 `rsync -avz --delete dist/ hk-vps:.../dist/` 覆盖生产、零回档）：改 **symlink-releases 模式**：
  - rsync 到 HK `:/opt/zenithjoy/autopilot-dashboard/releases/<tag>/`（**不带 `--delete` 到 live**）。
  - `ssh hk-vps "ln -sfn releases/<tag> /opt/zenithjoy/autopilot-dashboard/dist"`（`dist` 变软链，nginx document root 跟着软链走，**nginx 不用改**）。
  - 打 tag、写 `.production-release`、留存最近 5 份 `releases/<tag>/`（HK 上按目录序清旧）。
  - **回档** = `ssh hk-vps "ln -sfn releases/<上一tag> .../dist"`，**原子、瞬间、零拷贝**。
- **后端**（`deploy/deploy.sh`，已有 `.backups/<时间戳>/`）：补 tag + 留存清到最近 5 份 + 回档逻辑（恢复某份 backup + `docker compose up -d --force-recreate`）。
- **`rollback.sh`**：前端软链回拨 + 后端 backup 恢复，统一入口，遵循 §1 契约。

## 4. 阶段 1 明确不做（YAGNI 边界）

- ❌ 不建任何新 staging 环境（zenithjoy 这轮无 staging；cecelia 沿用已有 dashboard staging slot）
- ❌ 不做 staging 自动 E2E、不动人工放行 gate
- ❌ 不建 DB migration 向后兼容工具（只在 brain 回档加检测+警告）
- → 全部归阶段 2。

## 5. 测试（每个 repo 必须有能跑的回档 E2E，不能只写不验）

- **cecelia**：promote v1 → promote v2 → `rollback-cecelia.sh` → 断言 live `dist/` 内容回到 v1 + `.production-release` current 回到 v1 tag。用 fixture/测试钩子（`CECELIA_DEPLOY_ROOT` 已有）模拟，不碰真生产。
- **zenithjoy**：promote v1 → promote v2 → `rollback.sh` → 断言 `dist` 软链指向 v1 的 `releases/` 目录。可用本地临时目录模拟 HK 路径（注入 `HK_DEST`/`HK_HOST` 测试钩子），不碰真 HK 生产。
- 回档脚本必须有自动化测试覆盖核心断言（符合两 repo 各自 CI 的 DoD/test-pairing 规矩）。

## 6. 成功标准

- 两个 repo 各自：promote 必打 tag + 留旧版（≤5 份），生产炸了能用一条 `rollback.sh [tag]` 命令秒回上一版（或指定留存版）。
- zenithjoy 前端不再 `--delete` 覆盖生产；改 symlink-releases，回档零拷贝原子。
- cecelia dashboard 不再 `rm -rf` 删旧版。
- brain 回档遇 DB migration 有显式 `--confirm-db` 拦截，不默默踩。
- 每个 repo 一个绿的回档 E2E 测试，进 CI 永久回归。
- 各自走本 repo 的分支→CI→PR 流程（cecelia: cp-* 分支 + DoD/learning；zenithjoy: 本 repo 约定），**不直接碰生产、不在 main 提交**。
