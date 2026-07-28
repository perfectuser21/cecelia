# Handoff：fix(dev): mount root node_modules in node-brain-dev container

- task_id: unknown（本次为对话内临时排查，未走 /dev 注册 Brain task）
- initiative_id: N/A
- journey_id: N/A
- verdict: PASS
- created_at: 2026-07-28T08:40:00.000Z

## 完成了什么
- 排查"机器变卡"：定位到两个独立元凶——`_audiomxd` 卡死满核（蓝牙路由队列 `com.apple.mediaexperience.btroutingrequestqueue` 死循环，采样确认 778/778 落在同一调用栈）+ `cecelia-node-brain-dev` 容器崩溃重启死循环（`ERR_MODULE_NOT_FOUND: dotenv`）
- kill 掉卡死的 `_audiomxd` 进程；用 blueutil 关闭本机蓝牙（这台 Mac mini 无人值守、无蓝牙设备连接，根治该死循环复发）
- 根因定位：仓库是 npm workspaces monorepo，`dotenv` 等依赖提升到仓库根 `node_modules`，但 `docker-compose.dev.yml` 的 `node-brain-dev` 只挂载了 `./packages/brain:/app`；且原判断逻辑 `test -d node_modules || npm install` 只看目录是否存在，空目录/半安装状态会永久跳过安装
- 修复：PR #4402（已 squash-merge 到 main）—— 加 `./node_modules:/node_modules:ro` 只读挂载 + 判断逻辑改为检查 `/node_modules/dotenv/package.json` 是否存在
- 修复过程中顺带发现并修掉一个 CI 回归：`dev-env-db-guard-smoke.sh` 用 `grep -A10 container_name` 定位 `NODE_ENV=development`，新增的多行注释把该行推出窗口导致误报失败，已改成单行内联注释规避
- 原 PR #4401（分支名 `session-24ca01d4` 不符合 `cp-XXXXXXXX-task-name` 规范）被 branch-naming CI 挡下，已关闭，改用合规分支 `cp-07281623-fix-dev-brain-mount` 重开为 #4402 并合并

## 没完成什么
- 没有验证 `_audiomxd`/蓝牙路由死循环是否为该机型/该 macOS 版本的已知系统 bug（仅采样确认现象和触发路径是死循环自旋，未深挖 Apple 底层原因）
- 未检查其他 dev/staging 容器（如是否还有类似"只挂子目录、依赖被 workspace 提升"的隐患）

## 下一步建议
- 关注这台机器蓝牙关闭后 `_audiomxd` 是否不再复发；如果还复发，需要进一步排查是否有其他触发源（非蓝牙）
- 建议扫一遍其余 docker-compose*.yml 里挂了 npm workspaces 子包但没挂根 node_modules 的服务，避免同类问题

## 数据源（下一个大脑要加载的）
- docker-compose.dev.yml（node-brain-dev 服务定义）
- packages/brain/scripts/smoke/dev-env-db-guard-smoke.sh（NODE_ENV grep 窗口敏感，改动该服务定义时注意行数偏移）

## 关键决策引用
- 无（本次为纯排查+修复，无需 Alex 拍板的分叉点）

## 产物指针
- https://github.com/perfectuser21/cecelia/pull/4402
- sprint_dir: N/A
- branch: cp-07281623-fix-dev-brain-mount
