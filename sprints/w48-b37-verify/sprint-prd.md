# Sprint PRD — W48：playground GET /abs（B37 git diff 验证运行）

## OKR 对齐

- **对应 KR**：Harness 可靠性 — B37 sprint_dir 检测端到端验证
- **当前进度**：B37 fix 已合并，待真实 harness 运行验证
- **本次推进预期**：B37 git diff 机制在完整 harness 运行中确认可靠

## 背景

B37（#2960）修复 parsePrdNode 使用 `git diff --name-only origin/main HEAD -- sprints/` 确定性找新 sprint 目录，替代依赖 LLM 输出解析（B35/B36 多次失败根因）。W48 是 B37 合并后首次完整 harness 运行：planner 新建 `sprints/w48-b37-verify/`，parsePrdNode 通过 git diff 确定 sprint_dir，验证机制端到端生效。

## Golden Path（核心场景）

planner 在 `sprints/w48-b37-verify/` 写入 sprint-prd.md → parsePrdNode 调用 `git diff --name-only origin/main HEAD -- sprints/` 命中新目录 → sprint_dir 正确设为 `sprints/w48-b37-verify` → proposer/generator/evaluator 全程使用正确 sprint_dir 完成 `GET /abs` 实现

具体：
1. planner 在 worktree 新建 `sprints/w48-b37-verify/sprint-prd.md`（本文件）
2. parsePrdNode 执行 git diff，匹配到 `sprints/w48-b37-verify/sprint-prd.md`
3. sprint_dir 覆盖为 `sprints/w48-b37-verify`，不受 planner stdout 中旧目录引用干扰
4. playground `GET /abs` 被完整实现并通过 evaluator curl 验证

## Response Schema

### Endpoint: GET /abs

**Query Parameters**:
- `value` (integer-as-string, 必填): 匹配 `^-?\d+$`，且 `|Number(value)| ≤ 9007199254740990`
- **禁用 query 名**: `n`/`x`/`a`/`b`/`num`/`number`/`input`/`v`/`val`
- **强约束**: generator 必须字面用 `value`；用错名 endpoint 应返 400 或 404

**Success (HTTP 200)**:
```json
{"result": <number>, "operation": "abs"}
```
- 顶层 keys 完全等于 `["operation", "result"]`
- `result`: 输入数的绝对值（负数→正数，零→零，正数不变）
- `operation`: 字面字符串 `"abs"`，禁用变体 `absolute`/`absolute_value`/`magnitude`/`abso`
- **禁用响应字段名**: `value`/`answer`/`data`/`output`/`payload`/`response`/`sum`/`product`

**Error (HTTP 400)**:
```json
{"error": "<非空 string>"}
```
- 顶层 keys 完全等于 `["error"]`；禁用替代名 `message`/`msg`/`reason`/`detail`

**Schema 完整性**: success response 顶层 keys 必须完全等于 `["operation", "result"]`，不允许多余字段

## 边界情况

- `value=-5` → `{result: 5, operation: "abs"}`
- `value=0` → `{result: 0, operation: "abs"}`
- `value=3` → `{result: 3, operation: "abs"}`
- `value=abc` → 400 `{error: "..."}`
- `value` 缺失 → 400 `{error: "..."}`

## 范围限定

**在范围内**：`playground/server.js` 加 `GET /abs` 路由；`playground/tests/server.test.js` 加 `describe('GET /abs')`；`playground/README.md` 加 `/abs` 段
**不在范围内**：不动其他路由；不改 brain/engine/dashboard/apps；不加新依赖

## 假设

- [ASSUMPTION: playground/server.js 已有 math endpoint 结构，/abs 按相同校验模式实现]
- [ASSUMPTION: 整数精度上界沿用 Number.MAX_SAFE_INTEGER - 1 = 9007199254740990]

## 预期受影响文件

- `playground/server.js`: 加 GET /abs 路由
- `playground/tests/server.test.js`: 加 GET /abs 测试 describe 块
- `playground/README.md`: 加 /abs 端点说明

## journey_type: autonomous
## journey_type_reason: 仅动 playground 子项目，无 UI/brain/engine/远端 agent
