# Sprint PRD — attempt-run 桥接使用说明

task_request_hash: a0e238e17204e731116508f0c1dca99edeb5c7a72eee7e0a4533a338f3381f74

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固（系统可信赖、算力全开、管家闭环）
- **当前进度**：82%
- **本次推进预期**：补齐 attempt-run 桥接的可查阅使用契约

## 背景

为宿主和远端调用方提供统一、中文、可验证的 attempt-run 桥接说明，降低鉴权、派发参数和失败回滚状态的理解偏差。

## Golden Path（核心场景）

调用方从 `docs/current/` 打开《attempt-run 桥接使用说明》→ 按文档理解并调用 `POST /api/brain/harness/attempt-run` 创建运行 → 使用 `GET /api/brain/harness/attempt-run/:id` 查询状态 → 在成功或派发失败时识别最终状态。

具体：
1. 文档分别说明 POST 创建端点与 GET 查询端点的用途。
2. 文档说明两端点使用 `internalAuthOrLoopback`；宿主或远端请求必须携带 `Authorization: Bearer <CECELIA_INTERNAL_TOKEN>`，且不得暴露令牌值。
3. 文档逐项列出服务接受的九项角色白名单，不用“等”省略。
4. 文档说明 payload 必填 `sprint_dir`、`base_repo`、`branch`；`base_sha` 可省略并由生产 Brain 自解析。
5. 文档说明派发失败后的原子回滚结果：run→failed、session→closed、task→cancelled。

## 边界情况

- 区分本机 loopback 与宿主/远端鉴权要求，不把 loopback 例外扩展到远端。
- `base_sha` 省略仅表示由生产 Brain 自解析，不将其误写为必填或固定值。
- 失败回滚必须同时呈现 run、session、task 三个对象的终态，不只描述其中之一。

## 范围限定

**在范围内**：仅在 `docs/current/` 新增一页中文《attempt-run 桥接使用说明》，覆盖端点用途与鉴权、九项角色白名单、payload 字段、派发失败回滚四节。

**不在范围内**：不修改任何代码、测试、配置、API 行为、数据结构或现有文档；不执行真实 attempt-run 派发。

## 假设

- [ASSUMPTION: 文档中的九项角色名称以实现时生产 Brain 的权威白名单为准，并须逐项抄录，因 PrepPRD 仅给出数量、未给出名称。]
- [ASSUMPTION: 新文档文件名采用清晰的英文 kebab-case，标题保持中文《attempt-run 桥接使用说明》。]

## 预期受影响文件

- `docs/current/attempt-run-bridge-guide.md`：新增中文桥接使用说明；这是唯一允许变更的交付文件。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 待定（PrepPRD 未指定）
- 可观测: 文档必须明确派发失败时 run、session、task 的三个终态。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重；仅列与本 docs-only sprint 有接缝的活跃 area 铁律 -->
- [Planner 分支] Planner workspace 必须保持服务端签发的 planner_branch，不得自行切换分支（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [端点鉴权] 每个 API 端点必须有 auth，无鉴权端点不准 ship（来源: area）
- [禁止写死] 环境假设值不得写死，必须从环境推导或真实校准（来源: area）
- [真环境验收] 依赖真实环境的接缝断言必须在真实目标验证后才算 done（来源: area）
- [验证命令] 合同里的验证命令必须实跑确认退出码语义（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

- （本 line 暂无历史）

## E2E 验收

```bash
# proposer 应将下列验收点翻译为可执行脚本：
# 1. 断言 docs/current/attempt-run-bridge-guide.md 存在且正文含中文。
# 2. 断言文档包含 POST/GET 两个端点、internalAuthOrLoopback、Bearer CECELIA_INTERNAL_TOKEN。
# 3. 断言“角色白名单”章节恰好逐项列出九项角色。
# 4. 断言 payload 章节包含 sprint_dir/base_repo/branch，并说明 base_sha 可省略且由生产 Brain 自解析。
# 5. 断言失败回滚章节同时包含 run→failed、session→closed、task→cancelled。
# 6. 断言候选变更相对 implementation baseline 041438e33a737b9b3c8cb941b6603a4f1899aff3 仅新增上述文档，不含代码变更。
```

## journey_type: autonomous
## journey_type_reason: 交付物为 Cecelia 仓库内部 API 桥接说明文档，不涉及用户界面或远端 agent 协议实现。
## target_environment: mac_web
## target_environment_reason: task payload 显式指定 mac_web；验收在 us-mac-m4 工作区对中文文档及 Git diff 做机械检查。
## journey_id: none
## step_id: none（PrepPRD 未锚定）
