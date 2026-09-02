---
skeleton: false
journey_type: autonomous
---
# Contract DoD — attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge-guide.md` 中文文档；不改代码、API、数据库或配置。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 中文说明页存在且包含四个二级章节
  Test: node -e "const fs=require('fs');const p='docs/current/attempt-run-bridge-guide.md';const c=fs.readFileSync(p,'utf8');for(const h of ['## 端点用途与鉴权','## 角色白名单','## payload 字段','## 派发失败自动回滚'])if(!c.includes(h))process.exit(1);if(!/[\u4e00-\u9fff]/.test(c))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L1] B-01: 两个端点用途与 Bearer 鉴权说明完整
  动作: 读取 attempt-run 桥接说明的端点用途与鉴权章节。
  预期观察: POST 创建派发、GET 按 id 查询，且宿主/远端使用 internalAuthOrLoopback 与 Bearer 占位符。
  等待预算: 0s
  留证: Vitest 详细输出。
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts -t "两个端点用途与 Bearer 鉴权说明完整"'

- [ ] [BEHAVIOR] [L1] B-02: 角色白名单恰为生产代码定义的九项封闭集合
  动作: 读取说明的角色白名单章节并计数、比对允许值与禁用值。
  预期观察: 生产九项各出现一次，列表项恰为 9，critic/merger/reporter 不出现。
  等待预算: 0s
  留证: Vitest 详细输出。
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts -t "角色白名单恰为生产代码定义的九项封闭集合"'

- [ ] [BEHAVIOR] [L1] B-03: payload 必填字段与 base_sha 省略语义完整
  动作: 读取 payload 字段章节并逐字比对字段及省略语义。
  预期观察: sprint_dir/base_repo/branch 均标为必填，base_sha 明确可省略并由生产 Brain 自解析。
  等待预算: 0s
  留证: Vitest 详细输出。
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts -t "payload 必填字段与 base_sha 省略语义完整"'

- [ ] [BEHAVIOR] [L1] B-04: 派发失败回滚三项终态完整
  动作: 读取失败回滚章节并逐字比对三个关联对象的终态。
  预期观察: 文档同时写明 run→failed、session→closed、task→cancelled。
  等待预算: 0s
  留证: Vitest 详细输出。
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts -t "派发失败回滚三项终态完整"'

- [ ] [BEHAVIOR] [L1] B-05: 实现范围仅含目标文档
  动作: 以冻结 BASE_SHA 对 HEAD 执行 canonical git-diff 路径集合比较。
  预期观察: docs/current、packages、apps 范围内恰有目标文档一项，无代码变更。
  等待预算: 0s
  留证: git diff 与 diff 命令输出。
  Test: manual:bash -c 'BASE_SHA=48f6fae42a05d9ecb3e32cd5354b2ba94bf591a3; git diff --name-only "$BASE_SHA"...HEAD -- docs/current packages apps | sort | diff -u <(printf "%s\n" "docs/current/attempt-run-bridge-guide.md") -'

## Invariant 映射

- [端点鉴权] B-01 要求两个端点与 `internalAuthOrLoopback`、Bearer 请求头同章出现。
- [凭据安全] ARTIFACT/B-01 仅允许 `<CECELIA_INTERNAL_TOKEN>` 占位符；不得写真实 token。
- [Planner 分支] N/A：本 sprint 不修改 Planner workspace、分支或派发逻辑。
