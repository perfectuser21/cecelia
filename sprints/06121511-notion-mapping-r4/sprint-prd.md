# Sprint PRD — Brain↔Notion 属性映射修复（R4）

## OKR 对齐

- **对应 KR**：Cecelia Harness Pipeline 稳定性
- **当前进度**：Deterministic Gate 第 7/7 条（最终关）
- **本次推进预期**：消除三处持续 Notion 400，Deterministic Gate 完结

## 背景

06-10 Notion 重构后，三处属性名与实际 Notion DB schema 不符：notes 路由写入 "Initiative ID"、notion-task 路由写入 "Title"、notion-push-sync step_link 写入 "Order"，三处持续 400。R4 重发加入 DoD 自验条款：proposer 必须在容器内实跑每条 Test 命令，合同附 dod-selftest 凭证。

## Golden Path（核心场景）

用户/系统从 [Brain API 推送 Notion] → 经过 [属性名校验与降级] → 到达 [Notion 页面真实创建，无 400]

具体：
1. Brain 推送前查询目标 Notion DB 当前 schema（属性清单），禁止硬编码属性名，映射配置注查询日期
2. POST /api/brain/notes 带 initiative_id → 200，返回 url 经 Notion API GET 验证页面存在；DB 无 "Initiative ID" 属性 → 自动剔除 + response.warnings 数组说明
3. POST /api/brain/notion/task → 200 真建页（Notion API GET 验证），Title 属性名与 DB schema 一致
4. 触发 notion-push-sync → step_link 写入 Order 字段无 "is not a property" 400
5. 负向：故意传入未知属性 → 200 降级（非 500/502），warnings 数组留痕，不静默丢弃

## 边界情况

- 全部待写字段均不存在于 DB schema → 仍 200，warnings 列出所有跳过字段
- 某属性在 schema 中存在但类型不符 → [ASSUMPTION: 类型不符视同缺失，同样降级]

## 范围限定

**在范围内**：
- `packages/brain/src/routes/notes.js`：Initiative ID 字段降级
- `packages/brain/src/routes/notion-sync.js`：notion-task Title 属性校准
- `packages/brain/src/notion-push-sync.js`：step_link Order 属性校准
- 三处共用数据化映射配置（属性名表）
- 单测覆盖降级路径；E2E 测试页 [contract-e2e] 前缀，末尾 Notion API 归档

**不在范围内**：
- Notion API 连接超时 / 鉴权失败（已有机制）
- Dashboard UI 展示 warnings
- recurring-sync、memory-sync 等其他写入路径

## 假设

- [ASSUMPTION: Notion DB schema 在 E2E 执行时实查，属性清单以当时实际返回为准]
- [ASSUMPTION: 凭据走现有 NOTION_TOKEN / DB ID 机制，不新增凭据入口]
- [ASSUMPTION: proposer 在容器内实跑所有 [ARTIFACT] Test 命令后附 dod-selftest 凭证]

## 预期受影响文件

- `packages/brain/src/routes/notes.js`：Initiative ID 降级逻辑
- `packages/brain/src/routes/notion-sync.js`：notion-task Title 属性校准
- `packages/brain/src/notion-push-sync.js`：step_link Order 属性校准
- `packages/brain/src/__tests__/routes/notes-notion-task.test.js`：降级单测扩充
- `packages/brain/src/__tests__/notion-push-sync.test.js`：Order 降级单测

## E2E 验收

> Planner 初稿此区块可留空（只写占位 + 期望验收点自然语言描述）。最终可执行 E2E 脚本由 proposer 在 GAN 阶段产出（按 target_environment=local_api 写 bash 脚本，写进 contract-draft.md 的 ## E2E 验收 区块）。Planner 在此先框定"端到端要验到什么"，供 proposer 翻译成命令。

```bash
# 占位：proposer 按 target_environment=local_api 填入真实脚本
# 期望验收点（自然语言）：
# 1. POST /api/brain/notes 带 initiative_id → 200，返回 url 可 Notion API GET 确认页面存在
# 2. POST /api/brain/notion/task → 200，Notion API GET 验证页面真实存在
# 3. notion-push-sync 触发后 step_link 写入无 "is not a property" 400
# 4. 故意传未知属性 → 200 + warnings 数组含跳过字段说明（非 500/502）
# 5. E2E 测试页 [contract-e2e] 前缀；E2E 末尾 Notion API 归档（状态码 oracle）；teardown gate-allow 留痕
```

## journey_type: autonomous
## journey_type_reason: 纯 Brain 后端 API 修复（packages/brain/src/），无 UI 交互
## target_environment: local_api
## target_environment_reason: 验证 Brain API localhost:5221 + Notion API，本地 evaluator curl + psql
## journey_id: <来源 task.payload.journey_id；Cecelia Harness Pipeline Journey>
## step_id: <PrepPRD 锚定：Deterministic Gate 第 7/7 条，notion-mapping-fix>
