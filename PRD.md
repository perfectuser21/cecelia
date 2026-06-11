# PRD — Harness Evaluator 执行环境三处修复

## 背景

Harness pipeline 的 evaluator（pre-merge gate）执行环境有三处问题，导致 mac_web / 数据写入 / 微信 RPA 类合同验证物理上跑不起来：

1. **mac_web 路由缺失**：`evaluateContractNode` 无条件走 docker 容器，而 mac_web（Cecelia Dashboard）的 Playwright UI 验证需要真实浏览器 + localhost:5174/5221，无浏览器的容器里物理不可能。已写好的宿主执行器 `host-executor.js`（executeOnHost）是零调用方的死代码。
2. **WECHAT_RPA_WORKFLOW 未注入**：evaluator SKILL 变量表声称会注入此变量，实际 spawn env 里没有，目前靠 skill 内 fallback 默认值兜底。
3. **容器缺 psql**：evaluator 容器镜像 node:20-slim 没有 postgresql-client，合同里 `psql $DB ...` 的数据写入验证命令全部 command not found。

## 范围

- `packages/brain/src/workflows/harness-task.graph.js`：`evaluateContractNode` 按 `target_environment` 路由（mac_web → executeOnHost 宿主直跑，其余 → docker），并补注入 WECHAT_RPA_WORKFLOW。
- `docker/cecelia-runner/Dockerfile`：apt 安装列表加 postgresql-client。
- `scripts/sync-skills-snapshot.sh`（新增）：把 6 个 harness skill 的 SKILL.md 从 SSOT 同步到 monorepo 快照（本 PR 只加脚本不执行同步）。

## 成功标准

- mac_web 环境的 evaluator 走宿主执行（executeOnHost），可访问真实浏览器与 localhost Dashboard；其余环境保持 docker 路径不变（回归）。
- host 路径执行完直接读 `.brain-result.json` + schema 校验，产生与 docker 回调路径完全相同语义的 verdict/feedback 映射；读失败/schema 不符 → FAIL。
- docker 与 host 两条路径的 spawn env 都含 `WECHAT_RPA_WORKFLOW`。
- evaluator 容器镜像 Dockerfile 安装 postgresql-client，psql 验证命令可用。
- 新增 sync-skills-snapshot.sh 脚本：源缺失报错退出，逐个 cp 并输出 diff 统计。
