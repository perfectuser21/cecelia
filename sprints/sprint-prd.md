# Sprint PRD — playground 加 GET /ping endpoint（smoke fire）

## OKR 对齐

- **对应 KR**：Cecelia harness pipeline 端到端验证
- **本次推进预期**：用最小冒烟端点点火整条 harness 管道（planner→proposer→generator→evaluator→merge gate），确认链路全绿

## 背景

本 sprint 是一次 smoke fire（冒烟点火）——用 playground 最简单的 `/ping` 端点跑通完整 harness 管道，验证调度与各节点当前可用，不引入新业务逻辑。`/ping` 是标准存活探测端点，零参数、零计算，是冒烟测试的最小可行切片。

## Golden Path（核心场景）

HTTP 客户端从 [发起 `GET /ping`] → 经过 [playground server 命中 `/ping` 路由] → 到达 [200 响应 `{"pong":true}`]

具体：
1. 客户端发送 `GET /ping`（无 query 参数）
2. playground server 命中 `/ping` 路由
3. 返回 HTTP 200：`{"pong":true}`

<!-- Response Schema 由 Proposer 在 Step 1.1 读 api_registry 后推导，Planner 不负责定义技术规范。 -->

## 边界情况

- 带任意 query 参数（如 `/ping?x=1`）→ 仍正常返回 200 `{"pong":true}`（参数忽略，不报错）
- 其他 HTTP 方法（POST /ping）→ 不在范围（默认 express 404）

## 范围限定

**在范围内**：`playground/server.js` 加 `GET /ping` 路由；`playground/tests/server.test.js` 加 `describe('GET /ping')`；`playground/README.md` 加 `/ping` 段
**不在范围内**：不动其他路由 / 零依赖 / 不改 brain/engine/dashboard/apps

## 假设

- [ASSUMPTION: 无 PrepPRD/thin_prd 提供，"smoke fire" 推断为最小存活端点冒烟，选用标准 `/ping` → `{"pong":true}`]

## 预期受影响文件

- `playground/server.js`: 新增 `GET /ping` 路由
- `playground/tests/server.test.js`: 新增 `/ping` 测试
- `playground/README.md`: 新增 `/ping` 段

## E2E 验收

```bash
# 占位：proposer 将按 target_environment=playground 填入真实脚本
# 期望验收点（自然语言）：启动 playground，GET /ping 返回 200 且 body 为 {"pong":true}
cd playground && PLAYGROUND_PORT=3001 node server.js & SPID=$!
sleep 2
curl -f localhost:3001/ping | jq -e '.pong == true'
kill $SPID
echo "✅ playground /ping 冒烟验证通过"
```

## journey_type: autonomous
## journey_type_reason: 仅动 playground 子项目，无 UI/brain/engine/远端 agent
## target_environment: playground
## target_environment_reason: thin_prd 推断为 playground 训练 sprint，本地 node playground/server.js（localhost:3000/$PLAYGROUND_PORT）
## journey_id: <task.payload.journey_id 未提供，缺；smoke fire 训练 sprint 无 Journey 锚定>
## step_id: <无 PrepPRD Golden Path 锚定，smoke 冒烟无 Step 映射>
