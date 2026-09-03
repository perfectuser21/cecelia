---
skeleton: false
journey_type: dev_pipeline
---
# Contract DoD — attempt-run 桥接使用说明

task_request_hash: `64de302ba99ea7e35a528afdc12dbeaa8eede8d1076c32f7fef385b0504b9709`

**范围**: 仅新增 `docs/current/attempt-run-bridge-guide.md`，不修改代码、配置、测试或既有文档。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 中文说明文档位于唯一允许的产品路径
  Test: bash -c 'test -f docs/current/attempt-run-bridge-guide.md && grep -Pq "[\\x{4e00}-\\x{9fff}]" docs/current/attempt-run-bridge-guide.md'

- [ ] [ARTIFACT] 所有冻结合同工件引用同一 task_request_hash
  Test: bash -c 'H=64de302ba99ea7e35a528afdc12dbeaa8eede8d1076c32f7fef385b0504b9709; grep -Fq "$H" sprints/coding-harness-20260903063439-nm83sq/contract-draft.md && grep -Fq "$H" sprints/coding-harness-20260903063439-nm83sq/contract-dod.md && grep -Fq "$H" sprints/coding-harness-20260903063439-nm83sq/tests/attempt-run-bridge-guide.test.ts'

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L1] B-01: 读者能区分 POST 派发与 GET 查询
  动作: 打开说明文档并阅读端点用途一节
  预期观察: POST 被说明为创建/派发，GET 被说明为按 id 查询且不被误写成创建入口
  等待预算: 0s
  留证: Vitest 的通过/失败输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260903063439-nm83sq/tests/attempt-run-bridge-guide.test.ts -t "文档写明两个端点用途"'

- [ ] [BEHAVIOR] [L1] B-02: 读者能按位置采用正确鉴权且不会复制真实密钥
  动作: 阅读鉴权一节并检查宿主/远端请求头示例
  预期观察: internalAuthOrLoopback 与 Bearer 占位符齐全，远端免鉴权和真实 token 形态均被拒绝
  等待预算: 0s
  留证: Vitest 的通过/失败输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260903063439-nm83sq/tests/attempt-run-bridge-guide.test.ts -t "鉴权正向说明"'

- [ ] [BEHAVIOR] [L1] B-03: 角色白名单为恰好九项封闭集合
  动作: 阅读角色白名单并逐项核对生产角色
  预期观察: 九项角色逐行列名；重复、缺项、多项、“等”省略及 commander/publisher 均导致失败
  等待预算: 0s
  留证: Vitest 输出中的集合差异
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260903063439-nm83sq/tests/attempt-run-bridge-guide.test.ts -t "角色白名单是逐项列名"'

- [ ] [BEHAVIOR] [L1] B-04: payload 必填性与 base_sha 省略语义准确
  动作: 阅读 Payload 字段一节并准备请求参数
  预期观察: sprint_dir、base_repo、branch 标为必填；base_sha 标为可省略并由生产 Brain 解析
  等待预算: 0s
  留证: Vitest 的通过/失败输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260903063439-nm83sq/tests/attempt-run-bridge-guide.test.ts -t "payload 正向列出"'

- [ ] [BEHAVIOR] [L1] B-05: 派发失败的三实体回滚状态完整准确
  动作: 阅读派发失败自动回滚一节
  预期观察: run→failed、session→closed、task→cancelled 全部可见，相反终态均被拒绝
  等待预算: 0s
  留证: Vitest 的通过/失败输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260903063439-nm83sq/tests/attempt-run-bridge-guide.test.ts -t "派发失败正向列出"'

- [ ] [BEHAVIOR] [L1] INV-1: 唯一产品工件且无代码变更
  动作: 对冻结实现基线与候选 HEAD 执行 canonical git diff 范围检查
  预期观察: 排除本 sprint 合同工件后，变更列表恰好只有目标说明文档；任一额外文件导致失败
  等待预算: 0s
  留证: git diff 文件列表
  Test: manual:bash -c 'BASE_SHA="863590823193364151bd4aae610f68aaaa42e200"; SPRINT_DIR="sprints/coding-harness-20260903063439-nm83sq"; git diff --name-only "$BASE_SHA"...HEAD | grep -q "^docs/current/attempt-run-bridge-guide.md$" && test "$(git diff --name-only "$BASE_SHA"...HEAD | grep -v "^$SPRINT_DIR/" | wc -l | tr -d " ")" = 1'

## 铁律映射

- INV-1 [分支归属]: 本角色使用服务端签发的 proposer 分支；不改变 planner 分支。
- INV-2 [凭据安全]: B-02 同时验证占位符正例与真实密钥形态反例。
- INV-3 [端点鉴权]: B-02 要求两端点说明 internalAuthOrLoopback 和远端 Bearer。
- INV-4 [真相核对]: B-03 用生产 `ALLOWED_ROLES` 的恰好九项逐字集合冻结验收。

## 完成阈值

所有 ARTIFACT 与 BEHAVIOR 均为未预勾状态；Evaluator 全部执行且 exit 0 后才可判定完成。
