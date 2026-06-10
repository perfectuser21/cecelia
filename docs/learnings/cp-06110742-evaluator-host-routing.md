# Learning — Harness Evaluator 执行环境三处修复（mac_web host 路由 / WECHAT_RPA_WORKFLOW / psql）

分支：cp-06110742-evaluator-host-routing
日期：2026-06-11

## 背景

Harness evaluator（pre-merge gate）执行环境有三处使某类合同验证物理上跑不起来的问题，
审计已定位，本次按 /dev 纪律修复。

### 根本原因

1. **mac_web 路由缺失 — host-executor.js 是死代码**：`evaluateContractNode` 无条件
   `spawnDockerDetached`，把 evaluator 起在无浏览器的 docker 容器里。mac_web（Cecelia
   Dashboard）的 Playwright UI 验证需要真实浏览器 + 可达的 localhost:5174/5221，容器里
   做不到。早就写好的宿主执行器 `host-executor.js`（executeOnHost）零调用方，路由从未接通。

2. **WECHAT_RPA_WORKFLOW 声明与实现不一致**：evaluator SKILL 的「注入变量表」声称会注入
   `WECHAT_RPA_WORKFLOW`，但 `evaluateContractNode` 的 spawn env 里根本没这个 key，
   一直靠 skill 内 fallback 默认值兜底 —— 接口契约（SKILL 变量表）与调用方实现漂移。

3. **容器镜像缺 psql**：`docker/cecelia-runner/Dockerfile` 基于 node:20-slim，apt 列表
   没有 `postgresql-client`。合同里数据写入类验收的 `psql $DB ...` 命令在容器里全部
   command not found，DB 断言形同虚设。

## 修复

- `evaluateContractNode` 按 `target_environment` 路由：`mac_web → executeOnHost`（宿主直跑，
  同步等结果，不走 thread_lookup + interrupt 回调，执行完直接
  `readAndValidateBrainResult(worktreePath, EvaluatorOutputSchema)` 读 `.brain-result.json`，
  镜像 docker 回调路径的 verdict/feedback 映射；读失败/schema_mismatch → FAIL）；其余环境
  保持 docker 路径不变。host 路径 BRAIN_URL/HARNESS_CALLBACK_URL/DB 一律 localhost
  （host 上 host.docker.internal 不可解析）。
- 抽出共享 `baseEvalEnv`，两条路径都注入 `WECHAT_RPA_WORKFLOW`（payload 可覆盖）。
- Dockerfile apt 列表加 `postgresql-client`。
- 新增 `scripts/sync-skills-snapshot.sh`：把 6 个 harness skill 的 SKILL.md 从 SSOT
  （zenithjoy-skills）同步到 monorepo 快照 `packages/workflows/skills/`（本 PR 只加脚本）。
- 测试先行：`harness-task-evaluator-host-routing.test.js` 用 opts 注入 mock 覆盖
  mac_web→host / local_api→docker 回归 / 两路径 WECHAT_RPA_WORKFLOW / PASS 与非 0 退出。

### 下次预防

- 写好但零调用方的执行器（死代码）= 能力黑洞。新增执行路径时必须同步接通路由 +
  写一条「该环境走该执行器」的 regression 测试，否则等于没写。
- SKILL「注入变量表」是接口契约：改 SKILL 变量表或改 spawn env 任一侧，都要核对另一侧，
  避免「声称注入实际没注入」靠 fallback 兜底的隐性漂移。
- 容器镜像里跑的验证命令（psql/ffprobe 等）所依赖的 CLI 必须在 Dockerfile 里显式安装，
  base image「看起来够用」不代表够用 —— command not found 会让断言静默失效。

## checklist

- [ ] 新增执行器/执行路径时，同步接通路由并写「该环境走该执行器」regression 测试
- [ ] 改 SKILL 变量表或 spawn env 时，双侧核对接口契约一致
- [ ] 合同验证命令依赖的 CLI（psql 等）在 Dockerfile 显式安装并验证可用
- [ ] host 路径的 URL 用 localhost，不用 host.docker.internal（host 上不可解析）
