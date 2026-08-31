# Sprint PRD — attempt-run 桥接使用说明

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：补齐 V4 画布 Worker 的 attempt-run 桥接使用入口

## 背景

V4 画布 Worker 需要一页可直接查阅的中文说明，明确 attempt-run 桥接的调用入口、鉴权、角色范围、请求字段与派发失败后的状态回滚，降低宿主与远端接入时的误用风险。

## Golden Path（核心场景）

V4 画布 Worker 的接入者从 `docs/current/` 打开《attempt-run 桥接使用说明》→ 按文档理解并调用 `POST /api/brain/harness/attempt-run` 发起运行 → 通过 `GET /api/brain/harness/attempt-run/:id` 查询运行 → 能据此正确处理成功派发或失败回滚后的状态。

具体：
1. 文档分别说明 `POST /api/brain/harness/attempt-run` 的创建用途与 `GET /api/brain/harness/attempt-run/:id` 的查询用途。
2. 文档说明两端点使用 `internalAuthOrLoopback`，并明确宿主或远端请求必须携带 `Authorization: Bearer <CECELIA_INTERNAL_TOKEN>`，不得展示真实令牌。
3. 文档用完整清单逐项列出服务端允许的九个角色值，不用“等”或不完整示例替代。
4. 文档明确 payload 必填 `sprint_dir`、`base_repo`、`branch`；`base_sha` 可省略，并由生产 Brain 自行解析。
5. 文档明确派发失败会自动回滚为 `run → failed`、`session → closed`、`task → cancelled`。
6. 读者从同一页即可获得完整桥接契约，无需通过代码改动补足说明。

## 边界情况

- 区分 loopback 与宿主/远端调用，避免把 loopback 可访问误写成远端免鉴权。
- `base_sha` 只能描述为可省略，不能与三个必填字段混列。
- 回滚状态必须同时覆盖 run、session、task 三类对象及各自终态。
- 九项角色白名单必须完整、无重复，并与服务端当前允许值一致。

## 范围限定

**在范围内**：在 `docs/current/` 新增一页中文《attempt-run 桥接使用说明》，覆盖两个端点、鉴权、九项角色白名单、payload 字段和派发失败自动回滚。

**不在范围内**：修改任何代码、端点行为、鉴权策略、角色白名单、数据库结构、测试或部署配置；扩展其他 Harness API 文档。

## 假设

- [ASSUMPTION: 文档文件名采用可表达主题的英文 kebab-case，页面标题使用中文《attempt-run 桥接使用说明》。]
- [ASSUMPTION: 九项角色的精确名称以生产 Brain 当前服务端白名单为准，文档必须逐项照录。]
- [ASSUMPTION: 当前任务未绑定 journey/step，使用 none 作为锚定占位。]

## 预期受影响文件

- `docs/current/attempt-run-bridge-guide.md`：新增中文 attempt-run 桥接使用说明；这是唯一允许变化的交付文件。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 待定（PrepPRD 未指定）
- 可观测: 文档必须准确描述派发失败后 run、session、task 的三个可观察终态。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重；仅列与本次文档合同直接适用的 area 铁律 -->
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [端点鉴权] 每个 API 端点必须有 auth；无鉴权端点不准 ship（来源: area）
- [禁止写死环境假设值] 环境假设值不得写死，应从权威环境或契约推导（来源: area）
- [Planner 分支] Planner workspace 必须保持服务端签发的 planner_branch，不得自行切换（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
- （本 line 暂无历史）

## E2E 验收

```bash
# proposer 应将下列自然语言验收点翻译为可执行检查：
# 1. docs/current/ 下恰有目标中文说明页，且该页包含两个 attempt-run 端点字面。
# 2. 页面包含 internalAuthOrLoopback、Bearer、CECELIA_INTERNAL_TOKEN，并确认没有真实凭据。
# 3. 页面角色白名单章节恰好逐项列出九个服务端允许角色，完整且无重复。
# 4. 页面分别写明 sprint_dir/base_repo/branch 必填，以及 base_sha 可省略并由生产 Brain 自解析。
# 5. 页面包含 run→failed、session→closed、task→cancelled 三组失败回滚关系。
# 6. git diff 相对实现基线 1ef19bd6f70b79e14a20ecb0e37ba8492f71a029 只新增该 docs/current/ 文档，不含代码变化。
```

## journey_type: autonomous
## journey_type_reason: 交付物是 Cecelia 仓库内部 Harness API 使用文档，不含用户界面或远端 agent 协议变更。
## target_environment: mac_web
## target_environment_reason: task payload 显式指定 mac_web；验收在对应 Mac workspace 对文档内容与 git diff 执行检查。
## journey_id: none
## step_id: none（PrepPRD 未锚定）
