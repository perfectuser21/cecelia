# Sprint PRD — attempt-run 桥接使用说明

task_request_hash: 48d5205b78ea811a383f566cc90a57dde15db4e0402412e1d909afb6d25f7809

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：通过补齐桥接接口使用说明，降低调用与故障处置歧义

## 背景

生产 Brain 已提供 attempt-run 桥接能力，但调用方需要一页中文、可独立使用的权威说明，明确端点、鉴权、角色范围、请求字段和派发失败后的状态收敛行为。

## Golden Path（核心场景）

宿主或远端调用方从阅读 `docs/current/` 下《attempt-run 桥接使用说明》进入 → 按说明携带鉴权和必填 payload 调用 `POST /api/brain/harness/attempt-run` → 使用返回标识调用 `GET /api/brain/harness/attempt-run/:id` 查询 → 能正确理解成功结果或派发失败后的回滚状态。

具体：
1. 文档分别说明 POST 创建/派发 attempt-run 与 GET 按 id 查询 attempt-run 的用途。
2. 文档说明两端点采用 `internalAuthOrLoopback`；宿主/远端请求必须携带 `Authorization: Bearer <CECELIA_INTERNAL_TOKEN>`，且不得暴露真实令牌。
3. 文档单列并准确写出接口允许的九项角色白名单，不增加别名或额外角色。
4. 文档说明 payload 必填 `sprint_dir`、`base_repo`、`branch`；`base_sha` 可省略，并由生产 Brain 自行解析。
5. 文档说明派发失败后自动收敛为 `run→failed`、`session→closed`、`task→cancelled`。
6. 读者可据此形成一次无歧义的创建、查询与失败判读流程。

## 边界情况

- loopback 与宿主/远端的鉴权要求必须分开表述，不能让远端调用方误以为可免鉴权。
- `base_sha` 只可描述为可省略，不能列入必填字段，也不能暗示由客户端猜测或填充。
- 九项角色名称必须以生产接口的权威白名单为准，数量和拼写均须核对。
- 回滚状态是派发失败时的三个对象终态，不得描述成调用方另行触发的操作。

## 范围限定

**在范围内**：仅在 `docs/current/` 新增一页中文《attempt-run 桥接使用说明》，包含端点及鉴权、九项角色白名单、payload 字段规则、派发失败自动回滚四节。

**不在范围内**：不修改代码、接口、鉴权机制、角色白名单、数据库状态机、现有文档或其他目录文件；不新增测试代码。

## 假设

- [ASSUMPTION: 九项角色的精确名称由后续合同阶段依据生产接口权威定义固化；PrepPRD 仅给出数量，未逐项给出名称。]
- [ASSUMPTION: 新文档文件名采用仓库现有中文文档命名约定，标题必须为《attempt-run 桥接使用说明》。]
- [ASSUMPTION: Unified Map 未配置，因为 task.payload.map_scope/map_repo 缺少完整显式映射；本次仅按 PrepPRD 的 `docs/current/` 锚定范围。]

## 预期受影响文件

- `docs/current/<attempt-run-桥接使用说明>.md`：新增中文使用说明；实际文件名遵循目录既有命名约定。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 安全：不得在示例、正文或日志片段中写入真实 `CECELIA_INTERNAL_TOKEN`。
- 准确性：端点、鉴权名、九项角色、字段名和三组回滚终态必须与生产 Brain 一致。
- 可读性：全文使用简体中文，四个必需主题各有独立章节。
- 超时/延迟：待定（PrepPRD 未指定）。
- 频控：待定（PrepPRD 未指定）。
- 版本要求：以 implementation baseline `5a9c2d06c40622753cb13786ef31e81db8fc18b3` 为验收基线。
- 可观测：文档验收输出须能逐项证明四节存在且仓库代码未变化。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重；以下为与本次文档合同直接相关的活跃 area 铁律 -->
- [端点鉴权] 每个 API 端点必须有 auth；无鉴权端点不准 ship（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [环境假设] 环境假设值不得写死，必须由环境推导或真实校准（来源: area）
- [真环境验证] 依赖生产环境或真实调用方的接缝断言须在真实目标验证后才算 done（来源: area）
- [分支权威] Planner 必须停留在服务端签发的 planner_branch，Provider 不得自行切换分支（来源: area）
- [基线判定] 判变基准使用生产实体自报信息对账权威基线，不以工作区 diff 代替生产真相（来源: area）
- [失败语义] 返回 null/false 表示失败的契约必须显式处理失败分支，不能仅依赖异常捕获（来源: area）
- [语义验收] 通知或写库接口成功须检查语义字段，不能只凭通用 ok 字段判成功（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

- （本 line 暂无历史）

## E2E 验收

```bash
# 占位：proposer 将按 target_environment 填入真实脚本。
# 期望验收点：从 implementation baseline 对比候选提交，只新增 docs/current/ 下一个中文 Markdown 文档；
# 文档包含 POST 与 GET 端点用途、internalAuthOrLoopback 与远端 Bearer 鉴权、精确九项角色白名单、
# sprint_dir/base_repo/branch 必填与 base_sha 可省略规则，以及 run→failed/session→closed/task→cancelled；
# 同时逐项确认除目标文档外无代码或其他文件改动。
```

## journey_type: autonomous
## journey_type_reason: 本次是 Cecelia 后端桥接接口的使用文档，不包含用户界面或远端 Agent 协议变更。
## target_environment: mac_web
## target_environment_reason: task.payload 显式指定 mac_web；验收在 Mac 工作区核对中文文档内容与 Git 变更范围。
## journey_id: none
## step_id: none（PrepPRD 未锚定）
