# Sprint PRD — 系统总图页上线：map 投影现算渲染

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：让系统结构与覆盖状态首次在 Dashboard 可直接核验

## 背景

`GET /api/brain/map?scope=cecelia|zenithjoy-workspace` 已提供实时投影，Dashboard 尚无系统总图页。第三次登记需沿用实现基线 `6cc74f728b9c515cf67130a9b06b20e03d651772`，不重复前两次基础设施失败范围。

## Golden Path（核心场景）

用户从 Dashboard 的 system-hub 进入“系统总图” → 选择 `cecelia` 或 `zenithjoy-workspace` scope → 查看由 map 投影现算渲染的分层全景 → 通过搜索、折叠与状态提示定位能力及其证明。

具体：
1. 用户打开系统总图页，页面从 map API 获取所选 scope 的实时投影，并显示 manifest 版本与 freshness 徽标。
2. 页面按“价值流 → 能力 → 特性”展示三层可折叠结构；特性显示测试证明数和覆盖条，横切件及交接关系在独立面板可见。
3. 用户切换双 scope 或搜索节点后，视图仅展示匹配的实时结果，并保留清晰的层级关系。
4. 当 freshness 不是 `fresh` 或请求失败/无数据时，页面给出可见且不误报成功的状态。

## 边界情况

- map API 请求失败、返回空投影或 scope 无匹配节点时显示明确状态，不保留上一 scope 的旧数据冒充新结果。
- freshness 非 `fresh` 时必须持续可见提示；折叠、搜索和 scope 切换不得造成节点计数与 API 数据不一致。
- 搜索无结果时显示空结果反馈；快速切换 scope 时最终视图对应最后一次选择。

## 范围限定

**在范围内**：Dashboard 系统总图入口与页面；双 scope；三层折叠；证明数与覆盖条；横切件与交接面板；搜索；manifest/freshness 状态。

**不在范围内**：修改 map API 投影语义或数据模型；编辑地图数据；生产部署；新增第三个 scope。

## 假设

- [ASSUMPTION: map API 的节点、边、manifest_version、freshness 为页面展示的唯一实时数据真相。]
- [ASSUMPTION: 设计稿仅约束可见布局，页面数据必须来自 live fetch。]
- [ASSUMPTION: payload 未提供有效 `map_scope` + `map_repo` 显式映射，Unified Map scope 锚定标记为未配置；本 PRD 仅使用 PrepPRD 已给出的 API 与 scope。]

## 预期受影响文件

- `apps/dashboard/src/pages/map/MapPage.tsx`：系统总图页的用户可见行为。
- `apps/dashboard/src/pages/map/MapPage.test.tsx`：页面回归与断言格子。
- `apps/dashboard/src/` 下 system-hub 路由配置：提供页面入口。
- Dashboard 依赖清单：登记 `mind-elixir`（MIT）页面渲染依赖。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: Dashboard `mac_web`，localhost:5174；浏览器版本待定
- 可观测: manifest 版本与 freshness 必须可见，非 fresh 状态必须显式提示

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重；以下为与本 Dashboard sprint 可执行边界相关的 area 铁律 -->
- [分支权威] Planner workspace 必须保持服务端签发的 planner_branch，Provider 不得 checkout 或切换分支（来源: area）
- [禁止写死] 环境假设值禁止写死，必须从环境或真实目标推导（来源: area）
- [真环境验证] 依赖真实浏览器的接缝断言必须在 mac_web 真目标验证后才算 done（来源: area）
- [测试隔离] 涉及租户数据的测试默认至少两个租户并断言互不串（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [日志脱敏] 客户隐私、PII 与聊天内容不得明文进入日志（来源: area）
- [端点鉴权] 每个 API 端点必须有 auth，无鉴权端点不得发货（来源: area）
- [租户隔离] 涉及租户数据的查询与写入必须限定当前租户，禁止跨租户混读混写（来源: area）
- [验证命令] 合同中的验证命令须实跑并记录真实 exit code，确认目标解释器确实启动（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

（本 line 暂无历史）

## E2E 验收

```bash
# 占位：proposer 将按 mac_web 填入真实 Playwright 脚本
# 期望验收点：在 localhost:5174 从 system-hub 打开系统总图，真实 cecelia scope 渲染 2 条价值流和 11 个能力且与 map API 返回一致；切换双 scope、折叠、搜索、证明数/覆盖条、横切件与交接面板均可见；freshness 非 fresh 时出现明确提示。
```

## journey_type: user_facing
## journey_type_reason: 需求入口与全部可见行为均位于 apps/dashboard 的浏览器页面。
## target_environment: mac_web
## target_environment_reason: Dashboard E2E 在 us-mac-m4 的 localhost:5174 使用真实浏览器验证。
## journey_id: 8bb8252f-29b4-4c34-acb9-1accda7ddfcf
## step_id: keep-green
