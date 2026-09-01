---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge-guide.md` 中文文档，不改代码。
**大小**: S

## Invariant 映射

- Planner 分支：N/A，本合同不修改 Planner 分支或派发逻辑。
- 凭据安全：文档只写环境变量名 `CECELIA_INTERNAL_TOKEN`，不得写 token 值。
- 端点鉴权：B-02 明确两端点的 `internalAuthOrLoopback` 与宿主/远端 Bearer 要求。
- 禁止环境假设：N/A，本合同不写死机器或凭据值。
- 真实验证：N/A，本单不修改依赖真实调用方的接缝。

## ARTIFACT 条目

- [ ] [ARTIFACT] 中文说明文档是实现基线之外唯一非 Sprint 产物变更
  Test: bash -c 'DOC=docs/current/attempt-run-bridge-guide.md; BASE=de47c2d8b164a09ea5470eb9948ad6e8b2cf6ba1; node -e "const s=require('fs').readFileSync(process.argv[1],'utf8'); if(!/[一-龥]/.test(s)) process.exit(1)" "$DOC"; CHANGED=$(git diff --name-only "$BASE"...HEAD | awk '!/^sprints\\/coding-harness-20260901074430-dd5a61\\//'); test "$CHANGED" = "$DOC"'

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 读者能明确区分 POST 创建与 GET 查询
  动作: 打开说明页的端点章节，依次阅读 POST 与 GET 条目
  预期观察: POST 路径与创建/派发同句绑定，GET `:id` 路径与查询/轮询同句绑定
  等待预算: 0s
  留证: Vitest 定向测试输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901074430-dd5a61/tests/attempt-run-bridge-guide.test.ts -t "POST 明确用于创建且 GET 明确用于查询"'

- [ ] [BEHAVIOR] [L2] B-02: 宿主与远端分别被要求携带 Bearer token
  动作: 打开鉴权章节，分别查阅宿主请求与远端请求规则
  预期观察: 两类来源均明确携带 `Authorization: Bearer CECELIA_INTERNAL_TOKEN`，且没有免鉴权表述
  等待预算: 0s
  留证: Vitest 定向测试输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901074430-dd5a61/tests/attempt-run-bridge-guide.test.ts -t "鉴权明确要求宿主和远端分别携带 Bearer token"'

- [ ] [BEHAVIOR] [L2] B-03: 角色白名单精确为生产实现九项
  动作: 读取角色白名单章节的独立反引号列表
  预期观察: 列表按生产实现顺序恰好包含九项，无别名、增项或漏项
  等待预算: 0s
  留证: Vitest 定向测试输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901074430-dd5a61/tests/attempt-run-bridge-guide.test.ts -t "角色白名单恰好列出生产实现中的九项"'

- [ ] [BEHAVIOR] [L2] B-04: payload 必填性与 base_sha 省略语义清晰
  动作: 读取 payload 章节并逐项核对四个字段
  预期观察: `sprint_dir`、`base_repo`、`branch` 各自标为必填；`base_sha` 标为可省略并由生产 Brain 自解析
  等待预算: 0s
  留证: Vitest 定向测试输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901074430-dd5a61/tests/attempt-run-bridge-guide.test.ts -t "payload 区分三个必填字段"'

- [ ] [BEHAVIOR] [L2] B-05: 派发失败后三个关联对象全部收口
  动作: 读取派发失败自动回滚章节
  预期观察: 同一章节同时出现 `run→failed`、`session→closed`、`task→cancelled`
  等待预算: 0s
  留证: Vitest 定向测试输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901074430-dd5a61/tests/attempt-run-bridge-guide.test.ts -t "派发失败章节同时定义"'
