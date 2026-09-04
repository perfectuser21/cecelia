---
skeleton: false
journey_type: autonomous
---
# Contract DoD — attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge.md` 中文说明页，不修改代码。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] `docs/current/attempt-run-bridge.md` 存在且标题为《attempt-run 桥接使用说明》
  Test: node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge.md','utf8');if(!/^# attempt-run 桥接使用说明$/m.test(s))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L1] B-01: 两个端点用途与鉴权边界可被调用方准确识别
  动作: 阅读说明中的端点与鉴权两节
  预期观察: POST 被说明为创建并派发角色运行，GET 被说明为按 id 查询状态，并写明 internalAuthOrLoopback 与宿主/远端 Bearer 要求
  等待预算: 0s
  留证: Vitest 输出中的“两个端点用途与 internalAuthOrLoopback 鉴权说明完整”结果
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260904080748-lyofk5/tests/attempt-run-bridge-doc.test.ts -t "两个端点用途与 internalAuthOrLoopback 鉴权说明完整"'

- [ ] [BEHAVIOR] [L1] B-02: 角色白名单严格采用九项封闭集合
  动作: 阅读 roles 标记区间并逐项核对角色
  预期观察: 九项角色与生产 ALLOWED_ROLES 顺序和值完全一致，且 reporter 等非白名单角色不出现
  等待预算: 0s
  留证: Vitest 输出中的“角色白名单恰好等于生产九项封闭集合”结果
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260904080748-lyofk5/tests/attempt-run-bridge-doc.test.ts -t "角色白名单恰好等于生产九项封闭集合"'

- [ ] [BEHAVIOR] [L1] B-03: payload 必填项和 base_sha 省略语义无歧义
  动作: 阅读请求 payload 一节并核对字段约束
  预期观察: sprint_dir、base_repo、branch 均标为必填，base_sha 标为可省略且由生产 Brain 自解析，正文不反向宣称 base_sha 必填
  等待预算: 0s
  留证: Vitest 输出中的“payload 必填字段与 base_sha 可省略规则完整且无反向误述”结果
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260904080748-lyofk5/tests/attempt-run-bridge-doc.test.ts -t "payload 必填字段与 base_sha 可省略规则完整且无反向误述"'

- [ ] [BEHAVIOR] [L1] B-04: 派发失败回滚终态采用唯一允许组合
  动作: 阅读 rollback 标记区间并核对三类资源终态
  预期观察: 仅说明 run→failed、session→closed、task→cancelled，且不出现会误导为仍运行或成功的反向终态
  等待预算: 0s
  留证: Vitest 输出中的“派发失败回滚终态等于 run failed session closed task cancelled”结果
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260904080748-lyofk5/tests/attempt-run-bridge-doc.test.ts -t "派发失败回滚终态等于 run failed session closed task cancelled"'

- [ ] [BEHAVIOR] [L1] INV-1: 两个端点均保留鉴权说明且文档不包含真实令牌
  动作: 执行文档鉴权与凭据安全回归断言
  预期观察: internalAuthOrLoopback 与 Bearer 占位符存在，且没有疑似真实 Bearer 值
  等待预算: 0s
  留证: Node 断言退出码与 stdout
  Test: manual:bash -c 'node -e '\''const s=require("fs").readFileSync("docs/current/attempt-run-bridge.md","utf8");if(!s.includes("internalAuthOrLoopback")||!s.includes("Bearer <CECELIA_INTERNAL_TOKEN>")||/Bearer (?!<CECELIA_INTERNAL_TOKEN>)[A-Za-z0-9_.-]{12,}/.test(s))process.exit(1)'\'''

- [ ] [BEHAVIOR] [L1] INV-2: canonical git diff 仅含约定文档生产变更
  动作: 相对冻结实现基线检查排除 sprint 合同产物后的候选差异
  预期观察: 生产差异文件集合严格等于 docs/current/attempt-run-bridge.md，不含 packages、apps、配置或测试代码
  等待预算: 0s
  留证: git diff 文件清单
  Test: manual:bash -c 'BASE_SHA=22cd042f2c87358a8da4c97df9a25c09dc271082; ACTUAL=$(git diff --name-only "$BASE_SHA" HEAD -- . ":(exclude)sprints/coding-harness-20260904080748-lyofk5/**"); [ "$ACTUAL" = "docs/current/attempt-run-bridge.md" ]'

- [ ] [BEHAVIOR] [L1] INV-3: Planner 分支铁律不适用于本 docs-only 交付
  动作: 核对候选没有修改 Planner 或分支调度实现
  预期观察: canonical git diff 中 packages/brain 源码变更数量为零
  等待预算: 0s
  留证: git diff packages/brain 清单为空
  Test: manual:bash -c 'BASE_SHA=22cd042f2c87358a8da4c97df9a25c09dc271082; [ -z "$(git diff --name-only "$BASE_SHA" HEAD -- packages/brain)" ]'
