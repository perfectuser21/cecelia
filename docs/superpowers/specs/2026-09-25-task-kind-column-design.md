# 任务类型模型收敛·第一刀：tasks.kind 真列（agent | workflow）+ 属性约定

日期：2026-09-25　任务：Brain 94465721（链 bf5088a3 第 4 棒，原单 e9515577）　决策：df67a9d6 / b8abd28c / 69cd802f / 105a5868（C 档，报备即做）

## 0. 结论

主理人 09-22 拍板（df67a9d6）：任务只有两种 `kind`——**单 agent** 与 **workflow**；department / skill（或 workflow_ref）/ engine / device 全部是**属性**，不再各造一个 task_type。本刀只做地基：`tasks.kind` 真列 + CHECK + 注册表逐类型声明 + 建单写入校验 + 按注册表回填 + 一个消费方读它。84 个 task_type **不退役**（退役是后续刀，本刀零行为变化，见 §5）。

## 1. 模型

### 1.1 kind 判据（注册表每个 task_type 必须显式落一个）

| kind | 判据 | 例 |
|---|---|---|
| `agent` | 一个执行方一步交付（agent 会话 / 脚本 / 设备领单器 / Brain 内联处理都算「一步」） | dev、research、qiumi_task、device_job、harness_generate、harness_ci_watch |
| `workflow` | 类型本身不产结果，只编排 ≥2 个阶段/子任务/子步（有 orchestrator、stages、子任务链或 workflow_ref） | workflow_run、content-pipeline、harness_initiative、golden_path_proposal、harness_task、crystallize、project |

与 69cd802f 的 activity 四类执行方（脚本/agent/人/外部系统）的关系：那是**谁执行**，本刀的 kind 是**一步还是编排**；执行方继续由 `executor_kind` / `surface` 表达，不混。

### 1.2 属性落点（本刀只定约定 + 提供读取器，不迁移历史键）

| 属性 | 真身 | 写入方 | 兼容读取（`resolveTaskAttributes`） |
|---|---|---|---|
| department | `tasks.dept` 真列（迁移 066 已有，全库无数据，本刀启用） | 秋米路由 agent 分支落库时同步写；建单 `task.dept` | `dept` → `payload.department` → `payload.qiumi_department` |
| skill | `payload.skill`（缺省按注册表 `SKILL_WHITELIST[task_type]` 派生） | 不写，只派生 | `payload.skill` → `SKILL_WHITELIST` |
| workflow_ref | `payload.workflow_ref` | 秋米路由（现写 `qiumi_workflow_ref`，本刀双写） | `payload.workflow_ref` → `payload.qiumi_workflow_ref` |
| engine | `payload.engine`（claude / codex / terra），`payload.model` 为其查表结果 | 秋米路由 agent 分支 | `payload.engine` → `payload.qiumi_route.answers.engine` |
| device | `payload.serial`（device_job）/ `payload.device_hint.serial`（agent 分支留痕） | 秋米路由 / 设备派生 | `payload.serial` → `payload.device_hint.serial` |

Jev 路由输出 schema（`routing/qiumi-router.js`）已经按 `{engine, department, kind, workflow_ref, is_device, account}` 出题，本刀只把 `kind` 枚举改为 import 注册表 `TASK_KINDS`（铁律 76cb816c），并把判定结果写进真列。

## 2. 改动清单

| # | 落点 | 内容 |
|---|---|---|
| ① | `migrations/466_tasks_kind_column.sql` | `ADD COLUMN kind TEXT`；`tasks_kind_check CHECK (kind IS NULL OR kind IN ('agent','workflow')) NOT VALID`；分批（5000/批）回填 `WHERE kind IS NULL`，CASE 的 workflow 名单与注册表 `WORKFLOW_KIND_TASK_TYPES` 逐字一致（测试钉死）；`COMMENT ON COLUMN` |
| ② | `migrations/467_validate_tasks_kind_check.sql` | `VALIDATE CONSTRAINT`（照 461/462、463/464 拆法，不与 ACCESS EXCLUSIVE 同事务） |
| ③ | `lib/task-type-registry.js` | 每条 `T()` 带 `kind`（默认 `agent`，`workflow()` 包裹标 workflow）；导出 `TASK_KINDS` / `KIND_FOR_TASK_TYPE` / `WORKFLOW_KIND_TASK_TYPES` |
| ④ | `lib/task-kind.js`（新） | `deriveTaskKind(type)`（未知类型回落 agent）、`assertTaskKind(v)`（非法抛 `invalid_task_kind`）、`resolveTaskAttributes(task)` |
| ⑤ | `work-routing-store.js` | INSERT 加 `kind` 列：`task.kind`（先校验）?? `deriveTaskKind(canonical_task_type)` |
| ⑥ | `routes/task-tasks.js` | body 接 `kind`，非法 → 400 `INVALID_KIND`，合法透传 `task.kind` |
| ⑦ | `routing/qiumi-router.js` | `KIND_NAMES` 改 import；agent 分支 `persistDecision` 同步 `SET kind=$3, dept=$4`；payloadPatch 双写 `engine` / `workflow_ref` |
| ⑧ | `notion-push-sync.js` | `PUSH_TASKS_QUERY` 取 `t.kind`；Description 写 `<task_type> · <kind> · brain:<id>`（消费方①，`brain:` 标记位置不变，各 ingest 用 includes 判定不受影响） |
| ⑨ | `scripts/smoke/task-kind-column-smoke.sh` + `packages/quality/smoke-allowlist.txt` | feat 必配 smoke |
| ⑩ | `changes/cp-0925143137-baton4-kind-column.md` | 版本碎片 |

## 3. 不做

- 不退役任何 task_type、不改 `tasks_task_type_check`、不动派发谓词（零行为变化）。
- 不给 kind 加 `DEFAULT`：NULL = 未分类（只可能来自绕过 createRoutedTask 的直插），回填负责清零；不做 DB 触发器派生（真身在 JS 注册表）。
- 不迁移历史 payload 键（`qiumi_department` 等），读取器带兼容链。
- 不给 Notion 加列（一致性闸：Notion 缺列即整条推送红），只写进 Description 文本。

## 4. 测试策略

| 档 | 内容 | 位置 |
|---|---|---|
| unit | 注册表每个类型 `kind ∈ TASK_KINDS`；`WORKFLOW_KIND_TASK_TYPES` 与迁移 466 CASE 名单逐字一致（变异：删一项必红）；`assertTaskKind` 拒 `''`/`script`/`null`；`deriveTaskKind` 未知回落 agent；`resolveTaskAttributes` 兼容链 | `lib/__tests__/task-kind.test.js`、`lib/__tests__/task-type-registry.test.js` |
| unit | 迁移 466/467 与 rollback 文件结构断言 | `__tests__/migration-466-tasks-kind-column.test.js` |
| unit | `createRoutedTask` INSERT 带 kind、非法 kind 抛 `invalid_task_kind` 且不 INSERT | `__tests__/work-routing-store.test.js`（新，配套 lint） |
| unit | POST /tasks `kind:'script'` → 400；`kind:'workflow'` 透传 | `routes/__tests__/task-tasks.test.js` |
| unit | persistDecision(agent) UPDATE 带 kind/dept；pushTaskRows Description 含 kind | `routing/__tests__/qiumi-router.test.js`、`__tests__/notion-push-sync.test.js` |
| integration（真 PG，CI brain-integration） | 全量迁移后：列/约束存在；直插 kind NULL 行 → 重跑 466 回填块两次，第一次填齐、第二次 0 行（幂等）；`INSERT kind='script'` → 23514 | `__tests__/integration/task-kind-column.pg.integration.test.js` |
| smoke | 结构断言 + 可选真库列检查 | `scripts/smoke/task-kind-column-smoke.sh` |

## 5. 影响范围

- 生产：迁移 466 一次性回填全表（同 461 tenant_id 手法，分批 5000）；新建任务全部带 kind；Notion 任务页 Description 在下次状态翻转时多出一个 kind 词。
- 派发：不读 kind（本刀），谓词不变。
- 版本：碎片，不碰五件套。

## 6. 判定点登记表

（本任务无接缝判定点，N/A——kind 全部由注册表机械派生或 Jev 已有判定给出，不新增对外部真实状态的推断。）

## 7. 验收标准

- [ ] 上述 unit/integration 全绿，CI 全绿（Deploy Preview 503 既有红除外）
- [ ] 真库（cecelia_test）迁移后 `SELECT kind, count(*) FROM tasks GROUP BY 1` 无 NULL
- [ ] PR 合并、Brain 任务回写 completed 带 handoff
