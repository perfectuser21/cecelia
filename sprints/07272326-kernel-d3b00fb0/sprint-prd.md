# Sprint PRD — Preview workflow→preview route→DB/GitHub/decision log 的 current-SHA 门禁恢复

## OKR 对齐

- **对应 KR**：KR-2（Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环）
- **当前进度**：82%
- **本次推进预期**：84%

## 背景

本任务延续 2026-07-27 的多次 Recovery 失败，当前卡点是 preview 链路被错误替换成 helper/theater seam。此 sprint 只锚定真实接缝：`.github/workflows/preview-deploy.yml` 发起 `POST /api/brain/preview/start`，再由 `GET /api/brain/preview/status/:pr` 和 `packages/brain/src/routes/preview.js` 落库、查 GitHub 当前 PR head SHA、写入 decision log，并以 server-owned current-SHA 门禁阻断过期或伪造回执。

## Golden Path（核心场景）

用户/系统从 Preview workflow 入口 → 经过 preview route 对 DB/GitHub/decision log 的 server-owned current-SHA 校验 → 到达 Draft 保持不变且只留下隔离证据的出口。

具体：
1. Preview workflow 向真实 `POST /api/brain/preview/start` 发请求，机械记录 HTTP status 和 body，不得用 `curl -f` 或静默模式吞掉任何一者。
2. preview route 仅把调用方提供的 repository、PR、workflow run、task/run、branch/head 声明当作标识或相等性主张，再从服务端 DB/GitHub 真相解析 `target_environment`、`base_repo/repository`、required contexts、当前 PR head SHA、task/run 绑定和 Draft 状态。
3. 系统把 `port`、`db_name`、`status=starting` 等真实响应字段与 authority 证据绑定到隔离 PG 行，再通过真实 `GET /api/brain/preview/status/:pr`、ground-truth GitHub head、isolated DB、`orchestrator_decision_log` 和 legacy adapter 路径分别产出可核对记录；若 SHA、仓库、run/task、required contexts、approval 状态任一不一致，则以稳定 reason 拒绝推进，且不发生生产 merge、deploy 或人审 POST。

## 边界情况

- `stale_check_sha`：任何旧 head 或新 head 产生后的旧回执都必须失效。
- `wrong_repo`、`wrong_run_task`、`missing_context_mapping`：相等性主张与服务端真相不一致时，必须独立失败且保留对应稳定 reason。
- `missing_required_context`、`preview_required_failure`、`local_required_context_failure`：required contexts 缺失、失败或本地映射缺失必须拆成独立可执行断言，不得合并成 OR 或 grep 文本。
- `external_infrastructure_failure`：依赖加载完成后才允许进入真实 Red；vitest/config/import/基础设施启动失败不算业务 Red。
- `TEST_DATABASE_URL` 缺失、指向 `cecelia`、指向生产/默认 loopback、收据缺失或歧义时，必须在写入前拒绝。
- postmerge staging E2E、production promotion、final report 必须分别写成独立实际记录，并各自有正反验证；contract/evaluator 阶段只读 Draft/head/授权，不可 POST 人审或触发 merge。

## 范围限定

**在范围内**：真实 preview workflow 请求/响应 schema 校验；preview start/status 路由 authority 解析；isolated PG + current SHA + decision log 证据绑定；legacy adapter 原路径验真；postmerge staging/production/report 三段独立记录；严格 stable reason 与负向变体。
**不在范围内**：改用 `harness-callback.js`、approval route 或任何 helper seam 替代真实 preview seam；在 contract/evaluator 里执行生产 merge、生产 deploy、人工 approval POST；依赖源码 grep、helper existence、caller 自建 authority 行或 mock GitHub 真相。

## 假设

- [ASSUMPTION: GitHub PR #4372 在执行期仍可只读查询 Draft 状态与当前 head SHA，且可作为唯一外部真相 oracle。]
- [ASSUMPTION: 当前恢复 sprint 的 `target_environment` 继续使用 DB payload 已声明的 `local_api`，E2E 在本地 Brain API + 隔离测试数据库上完成。]

## 预期受影响文件

- `.github/workflows/preview-deploy.yml`: 真实 workflow 请求必须显式保留 HTTP status/body，并按 route schema 发送字段与头。
- `packages/brain/src/routes/preview.js`: 真实 authority 解析、current-SHA 门禁、Draft/required-context 校验、稳定 reason 与 decision log 写入。
- `packages/brain/src/...preview*`: preview status、postmerge staging、promotion、final report、legacy adapter 相关服务需要与同一 SHA/记录身份对账。
- `tests/...preview*`: 每个稳定 blocker、每个负向变体、legacy adapter、postmerge 三段记录、零生产变更和真实 Red 语义都需要独立可执行测试。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

- [语义成功] 通知/写库接口的成功判定必须看语义字段（sent/accepted），不能只 grep `ok:true`（来源: area）
- [环境路由] `target_environment` 必须从 DB `tasks.payload` 读取，不从文件猜测（来源: area）
- [产出核验] 不能只凭进程 exit code 或最近一条记录判定完成，必须核对预期产出物和记录身份（来源: area）
- [点火锚点] headed relay/preview 链路必须带 `base_repo` 或等价 PR 锚点，避免收账与 GitHub 反查失明（来源: area）
- [生产实体自报] SHA 对账必须基于服务端或 GitHub 实体自报真相，不能用调用方自喂值或工作区 diff 代替（来源: area）
- [环境假设] 禁止写死默认/生产 PostgreSQL 等环境假设值，必须从显式输入或真实环境校验得出（来源: area）
- [真环境验证] 依赖真实调用方/真实 GitHub/真实数据库的接缝断言，只有在真目标上验过才算 done（来源: area）
- [共享 CI 文件] 修改 `.github/workflows/*.yml` 属共享 CI 接缝，合同必须显式授权并以真实验收覆盖（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

（本 line 暂无历史）

## NFR 约束

- 超时/延迟: 待定（PrepPRD 未指定明确秒数；workflow 与 route 响应不得吞 HTTP status/body）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 执行时必须绑定 `main` 的 `d37a5e57827900be2651fe39655690238513128f` 或更新 SHA；新 head 出现即旧收据失效
- 可观测: 每次 workflow、preview route、isolated DB、GitHub head、`orchestrator_decision_log`、legacy adapter、postmerge 三段记录都必须保存 repository/run/task/current SHA 绑定证据，且不得产生生产变更

## E2E 验收

```bash
# 占位：proposer 将按 target_environment 填入真实脚本（local_api→curl+psql）
# 期望验收点（自然语言）：
# 1. 真实 preview workflow 请求命中真实 preview start/status 路由，完整记录 HTTP status/body 与实际 schema 字段。
# 2. route 仅接受调用方标识/相等性主张，并从服务端 DB/GitHub 解析 current head SHA、required contexts、Draft 状态与 task/run 绑定。
# 3. isolated PG、decision log、legacy adapter、postmerge staging、production promotion、final report 各自产生同一最终 SHA 的独立记录。
# 4. stale_check_sha、wrong_repo、wrong_run_task、missing_required_context、preview_required_failure、local_required_context_failure、missing_context_mapping、external_infrastructure_failure 及其必要反例均独立可执行并返回稳定 reason。
# 5. contract/evaluator 全程零生产 merge、零生产 deploy、零人工 approval POST；PR 保持 Draft，只有已种下的人审授权记录可被只读验证。
```

## journey_type: autonomous
## journey_type_reason: 范围集中在 `.github/workflows/preview-deploy.yml` 与 `packages/brain/src/routes/preview.js` 的后端/调度链路，没有前端或远端 agent 交互
## target_environment: local_api
## target_environment_reason: task payload 已显式声明 `local_api`，且本 sprint 只验证本地 Brain API、真实 GitHub 只读 oracle 与隔离测试数据库
## journey_id: bb8cc561-b3ee-4fec-b74d-2255694bd963
## step_id: 0cdadc1a-e3a0-46a1-8333-ebbc102883f7
