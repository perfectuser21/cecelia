# Sprint PRD — Golden Path 重塑为 owner_task_id 模型 + step 级 NFR 决策读写

## OKR 对齐

- **对应 KR**：Cecelia Harness/Dev 基础设施（Decision System 地基）
- **当前进度**：ability 级决策读写已通（PR #3391 已合并 main）
- **本次推进预期**：补 step / golden_path 级决策读写 + golden_path 表对齐正模型

## 背景

PR #3391 把 decisions 分层表 + ability 级读写做通了，但实测发现三个缺口：
1. `POST /decisions` 只校验 `target_type=journey_feature`，`target_type=golden_path` 完全不校验 → 可写悬空引用。
2. 没有任何 step/golden_path 决策的读回视图 → NFR 挂到 golden_path 步骤后拿不回验收单。
3. golden_path 表是错模型（`scope_type+scope_id+order_no+ability_id`），与 CLAUDE.md 唯一正模型（每个 Task 一条 Golden Path、`owner_task_id`、scope=那个 task）矛盾，`scope_type=journey` 正是"把一条线下多个 ability 排序"的坑。

golden_path 表 0 行、step/golden_path 决策 0 条 → 本 sprint 零迁移成本、零存量包袱。下一个 migration 版本号 = 303。

## Golden Path（核心场景）

主理人给某个 task 的 golden path 某一步记一条 NFR（前后台=后台静默, v1），既能按"这一步"查，也能按"这个 task 整条 golden path"拉出 NFR 验收单。

具体（单线性）：
1. 用户 `POST /api/brain/golden_path`，带 `{owner_task_id:<真实 task>, order_no:1, feature_id:<某 feature>}` → 系统校验 task 存在 → 写入 → 返回该步 id
2. 用户 `POST /api/brain/decisions`，带 `{category:'nfr', topic:'前后台', decision:'后台静默', level:'step', target_type:'golden_path', target_id:<上一步返回的 golden_path id>, scope:'v1'}` → 系统校验该 golden_path 存在 → 写入 → 返回决策 id
3. 用户 `GET /api/brain/golden_path/<step_id>/decisions?scope=v1` → 拿回该步的 v1 决策（含刚写那条）
4. 用户 `GET /api/brain/tasks/<task_id>/golden-path-decisions?category=nfr&scope=v1` → 拿回该 task 整条 golden path 的 NFR 验收单（按 owner_task_id join 出整条 golden path 的步骤决策）

## 边界情况

- decisions `target_type=golden_path` 但 target_id 不存在 → 400 + error(string)
- decisions `target_type=golden_path` 但 target_id 非法 uuid → 400（不可 500）
- golden_path 的 owner_task_id 不存在 → 400
- 读回视图无匹配决策 → 返回空清单（200，不报错）

## 范围限定

**在范围内**：
- migration 303 重塑 golden_path 表（owner_task_id / order_no / feature_id / note，旧 scope_type/scope_id 列移除，index (owner_task_id, order_no)）
- 重写 3 个 golden_path 端点（GET 列表 / POST / PATCH）对齐新模型
- POST /decisions 对 golden_path target 补存在性校验
- 两个决策读回视图（按步 / 按 task 整条 golden path）
- 端到端 smoke（failing smoke commit-1 → 实现 commit-2）

**不在范围内**：
- Notion 同步 golden_path 决策链到"步"（走已有 pushDecisions，step→golden_path 的 Notion relation 留后续）
- Dev 驾驶舱、Gate1/Gate2、decision_catalog、95k 空 level 噪音清理、修 harness 合并门假摔（Issue 5b4f18d0）

## 假设

- [ASSUMPTION: golden_path 表空可直接 DROP 旧列/重建，无需数据迁移]
- [ASSUMPTION: smoke 内可新建一条带 ability_id 的真实 task 作测试夹具，或复用现有 task]

## 预期受影响文件

- `packages/brain/migrations/303_*.sql`：重塑 golden_path 表
- `packages/brain/src/routes/`（golden_path 端点所在文件）：重写 3 个端点 + 2 个读回视图
- `packages/brain/src/routes/`（decisions 端点所在文件）：补 golden_path target 校验
- `packages/brain/`（smoke 测试目录）：端到端 smoke

## E2E 验收

> Planner 初稿留占位，最终可执行脚本由 proposer 按 target_environment=local_api 产出（curl localhost:5221 + psql）。

```bash
# 占位：proposer 将填入真实 local_api 脚本（curl + psql）
# 期望验收点（自然语言）：
# 1. migration 303 应用后 \d golden_path 显示 owner_task_id(FK tasks) / order_no / feature_id(FK journey_features) / note；旧 scope_type/scope_id 列已移除
# 2. POST /golden_path（owner_task_id 真实 + order_no）→ 201 且库里查得到；owner_task_id 不存在 → 400
# 3. POST /decisions（level=step, target_type=golden_path, target_id=真实步）→ 201；target_id 不存在 / 非法 uuid → 400
# 4. GET /golden_path/:id/decisions?scope=v1 → 含该决策
# 5. GET /tasks/:id/golden-path-decisions?category=nfr&scope=v1 → 含该决策
```

## journey_type: autonomous
## journey_type_reason: 改动全在 packages/brain/（migration + golden_path/decisions 端点），纯后端自治，无 UI/agent 协议/engine 介入
## target_environment: local_api
## target_environment_reason: 纯 Brain API 验证，本地 evaluator 用 curl localhost:5221 + psql 即可，无外部凭据
## journey_id: Cecelia Harness Pipeline（Line 唯一；来源 task.payload.journey_id，缺则取 PrepPRD 锚定）
## step_id: Decision System 地基 follow-up — step 级 / golden_path NFR 决策读写（来源 PrepPRD Golden Path 锚定）
