# Sprint PRD — 统一 Work Router 与 Kernel Harness 2.0 强制路由

## OKR 对齐

- **对应 KR**：none（Brain context 未返回活跃 KR）
- **当前进度**：未配置
- **本次推进预期**：完成 Knife 0-5 与恢复前置回归的可执行合同

## 背景

前序 run 将含凭据的 Git origin 误判为孤儿，并在活跃 Kernel 使用中删除 Controller cwd，导致 `kernel_process_fatal`。本 sprint 先永久修复该回归，再交付统一 Work Router：所有有头/无头 coding mutation 在动作前获得不可变 Routing Receipt，统一进入 Kernel Harness 2.0。

## Golden Path（核心场景）

系统从任一真实工作入口接收 coding mutation → 先生成不可变 Routing Receipt → 进入 Kernel Harness 2.0 → 读取 fresh Universal Map 并建立 Impact Contract → 按四档 `change_kind` 正向选择执行形态 → 经 Generator trust boundary、Evaluator、Judge、CI 与 merge fence → 在 scratch 多入口真实验收中观察到完整审计链。

具体：
1. 恢复前置：含凭据 Git origin 归一化后与无凭据 origin 等价，日志不泄露凭据，活跃或 detached Kernel 工作区不被 orphan 清理；每项先 RED commit 再 GREEN commit，回归测试永久进入 CI。
2. Knife 0-1：从 `VALID_TASK_TYPES` 与实际建任务入口冻结事实基线；同一事务原子创建 task 与 append-only Routing Receipt，失败整体回滚；四种 `change_kind` 只能正向映射默认 profile，禁止从 gear/stage/task type 反推或降档。
3. Knife 2：Brain API、Intent、Capture、Actions、自动修复、巡检、回调、子任务和 Scheduler 等清单内入口均委托同一创建边界；coding mutation 统一成为 `harness_initiative`，content/research/read-only 保持各自 Pipeline。
4. Knife 3：每个 coding Harness 在计划或生成前解析唯一 repo、读取同 repo fresh Universal Map、校验 baseline revision/scanner 并建立 required Impact Contract；失败返回稳定 reason code 且不启动 Provider。
5. Map 恢复：仅稳定 Map/scanner/projection 故障、`bugfix`、未过期单次合同与冻结 allowlist 可走 `map_recovery`；修复后全量 scanner 同 revision 且 Map fresh 才能成功。
6. Knife 4：有头 mutation-capable tool 在动作前校验 live `/dev`、完整 `.dev-lock`、receipt、active run/attempt、repo/worktree/branch/HEAD；无头 Dispatcher 在 executor 前校验同一 receipt，任一不一致均 fail closed 并记录 `route_violation`。
7. 所有 Generator run 强制 frozen-baseline pre-push 与退出 lineage assertion；Provider 无 push/callback/lease 凭据、降权运行且容器内 hook 真正生效，只有受信任 transport 可发布获批 ref。
8. Knife 5：scratch 从 API、Intent、Capture 三个真实入口创建 coding mutation，并创建 content、research、read-only 对照；数据库证明确认 receipt、Harness、正确 repo Map、active Impact Contract、stale 阻断与 refresh/resume 审计均真实成立。

## 边界情况

- coding 意图不确定时按 write；repo 未知、不唯一、Map missing/stale/invalid、Impact Contract 无法建立时失败关闭，不默认 Cecelia、不产生新 `legacy_exempt`。
- receipt 过期、superseded、伪造 payload、Brain API 不可达、worktree/HEAD 不匹配均不得降级执行；只读诊断不被误伤。
- 正常 Map 可用时拒绝 `map_recovery`；恢复合同不得复用、不得修改业务 capability。
- 旧 running attempt 只记录审计并收口；未开始旧任务先 dry-run，保留 task id 与原始 payload后新增 receipt。

## 范围限定

**在范围内**：RECOVERY ADDENDUM；设计 Knife 0-5；实施计划五个 Workstream；Routing Receipt、四形式、全入口收敛、Map/Impact Contract、动作闸、Generator trust boundary、迁移、可观测性与 scratch 真实验收。

**不在范围内**：重写 Harness 状态机；把所有 task type 变成顶层入口；内容/研究强塞入 Coding Harness；人工登记 Map；中途切换运行中旧 attempt；删除历史审计。

## 假设

- [ASSUMPTION: 本 sprint 的 Journey step 以 PrepPRD 的 Knife 0-5 整体批准范围锚定；payload 未提供独立 step_id。]
- [ASSUMPTION: `map_scope=cecelia` 已配置但 `map_repo` 缺失；Unified Map 当前地图按规则记为未配置，实施时 repo 必须由 Routing Receipt 显式解析。]
- [ASSUMPTION: 真实验收使用隔离的 `cecelia_scratch` 与临时 Git repo，不修改生产数据。]

## 预期受影响文件

- `packages/brain/src/work-router.js`、`work-routing-store.js`、`routes/work-routing.js`、`migrations/411_work_routing_receipts.sql`：统一路由与不可变凭证合同。
- `packages/brain/src/routes/task-tasks.js`、`planner.js`、`proposal.js`、`routes/capture-atoms.js`、`actions.js`、`intent.js`：建任务入口收敛及既有三陷阱回归。
- `packages/brain/src/orchestrator/`：四形式、Map/Impact Contract preflight、Dispatcher 安全闸及工作区恢复保护。
- `packages/engine/hooks/dev-mode-tool-guard.sh`、`packages/engine/skills/dev/scripts/worktree-manage.sh`：有头动作前 receipt 合同。
- `docker/cecelia-runner/entrypoint.sh`：Generator frozen baseline 与 trust boundary。
- `packages/brain/scripts/smoke/unified-work-router-smoke.sh`、相关 Brain/Engine/runner 测试：scratch 多入口真实验收与永久回归。
- `apps/dashboard/src/pages/warroom/WarRoomPage.tsx`、Brain 版本与 `DEFINITION.md`：审计视图和版本同步。

## 验收标准（DoD，最多 8 条）

1. 含凭据 origin 的 RED 能稳定复现误判及泄露，GREEN 证明 canonical origin 等价、日志脱敏、活跃 Kernel cwd 不被删除；测试永久保留。
2. 四档 `change_kind` 正向映射、不可变 receipt、事务原子性、幂等与 repo 歧义均由 RED→GREEN 合同覆盖。
3. 冻结入口清单逐项证明 coding mutation 只产出 `harness_initiative`，三处已知坏写入永久回归，非 coding 对照不误路由。
4. fresh/missing/stale/revision/scanner/cross-repo 与合法/非法 `map_recovery` 使用真实测试数据库和临时 Git repo 验证；coding run 的 Impact Contract 全为 required。
5. 有头与无头动作闸对缺失、过期、superseded、API 不可达及 worktree/HEAD 不匹配 fail closed，合法 receipt 正常通过，伪造 payload 无法绕过。
6. 真实容器证明 Generator push 被阻断、敏感 callback/lease 环境不可见、非特权执行、hook 路径存在生效、trusted transport 仅在 Judge 后发布。
7. scratch 的三种 coding 入口和三种非 coding 对照均查数据库确认真实路由结果；stale 阻断、refresh/resume 与原失败审计保留可重复验证。
8. 规定 DevGate、受影响测试、smoke、`git diff --check` 与 CI 全绿，生产只读观测为新 `legacy_exempt=0`、coding receipt coverage=100%。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: Brain 代码变更必须同步 patch version 与 `DEFINITION.md`
- 可观测: 路由失败使用稳定 reason_code；保留 receipt、失败与 resume 审计；凭据不得进入日志

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重；以下为本 scope 适用的 active area 铁律 -->
- [验证时钟] `validation_clock_required` 默认 fail-closed，仅符合既有 PR hotfix 严格条件时共享（来源: area）
- [工作台账] `.harness/progress.md` 必须保持在 git 追踪之外（来源: area）
- [受控工作区] headed `worktree_path` 必须写入 task payload 且位于受控 Harness 根目录（来源: area）
- [单写手] 单 slot 任务串行；任务内同一时刻只有一个代码实现者（来源: area）
- [环境事实] 环境假设值不得写死，必须从环境推导或真实校准（来源: area）
- [真实验收] 依赖真实环境的接缝必须在目标环境验证后才算 done（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [日志脱敏] 客户隐私、PII 与敏感内容不得明文进入日志（来源: area）
- [端点鉴权] 每个 API 端点必须有鉴权，无鉴权端点不得交付（来源: area）
- [租户隔离] 租户数据查询与写入必须限定当前租户，禁止跨租户混读混写（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

（本 line 暂无历史）

## E2E 验收

```bash
# proposer 必须把下列自然语言验收点翻译为 local_api 可执行脚本：
# 在隔离 scratch 数据库和临时 Git repo，从 API/Intent/Capture 创建三项 coding mutation；
# 查询数据库确认每项 receipt、Harness、正确 repo Map、required Impact Contract；制造 stale 后确认 Provider 未启动，刷新后 resume 并保留失败审计；
# 创建 content/research/read-only 对照，并在真实 runner 容器验证 Generator trust boundary。
node scripts/facts-check.mjs
bash scripts/check-version-sync.sh
node packages/quality/scripts/devgate/check-dod-mapping.cjs
bash packages/brain/scripts/smoke/unified-work-router-smoke.sh
```

## journey_type: autonomous
## journey_type_reason: 核心路径为 packages/brain、packages/engine 与 runner 的后端自主执行治理，未包含用户界面主流程。
## target_environment: local_api
## target_environment_reason: payload 显式指定 local_api；主要真验在本地 Brain API、隔离 PostgreSQL、临时 Git repo 与 runner 容器完成。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: none（PrepPRD 未锚定）
