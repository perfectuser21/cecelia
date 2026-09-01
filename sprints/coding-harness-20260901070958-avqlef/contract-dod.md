---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge-guide.md`；合同产物位于本 Sprint 目录。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 中文说明文档是唯一产品交付文件
  Test: bash -c 'GUIDE=docs/current/attempt-run-bridge-guide.md; test -f "$GUIDE"; test -n "$(git diff --name-only 109d1df64cdc68fbec8852c3ad2d0e3291e648ef...HEAD -- "$GUIDE")"; test -z "$(git diff --name-only 109d1df64cdc68fbec8852c3ad2d0e3291e648ef...HEAD -- . ":(exclude)sprints/coding-harness-20260901070958-avqlef" | grep -Fvx "$GUIDE" || true)"'

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 读者能区分 POST 派发与 GET 查询用途
  动作: 打开 `docs/current/attempt-run-bridge-guide.md` 并阅读端点用途节
  预期观察: 中文正文分别说明 POST 派发与 GET 状态查询
  等待预算: 0s
  留证: node 命令输出与 exit code
  Test: manual:bash -c 'node -e "const s=require('"'"'fs'"'"').readFileSync('"'"'docs/current/attempt-run-bridge-guide.md'"'"','"'"'utf8'"'"');if(!/[\\u4e00-\\u9fff]/.test(s)||!s.includes('"'"'POST /api/brain/harness/attempt-run'"'"')||!s.includes('"'"'GET /api/brain/harness/attempt-run/:id'"'"')||!/派发/.test(s)||!/(查询|轮询)/.test(s))process.exit(1)"'

- [ ] [BEHAVIOR] [L2] B-02: 远端调用方能识别强制 Bearer 鉴权
  动作: 阅读鉴权节并核对中间件名、调用方范围和 token 环境变量名
  预期观察: 显示 `internalAuthOrLoopback`、宿主/远端必须携带 `Bearer CECELIA_INTERNAL_TOKEN`
  等待预算: 0s
  留证: node 命令输出与 exit code
  Test: manual:bash -c 'node -e "const s=require('"'"'fs'"'"').readFileSync('"'"'docs/current/attempt-run-bridge-guide.md'"'"','"'"'utf8'"'"');if(!s.includes('"'"'internalAuthOrLoopback'"'"')||!s.includes('"'"'Bearer CECELIA_INTERNAL_TOKEN'"'"')||!/(宿主|远端)/.test(s))process.exit(1)"'

- [ ] [BEHAVIOR] [L2] B-03: 角色白名单是冻结 PRD 的九项精确闭集
  动作: 解析文档「角色白名单」节的逐行代码项
  预期观察: 解析结果与九项角色数组按顺序全等，无漏项或额外角色
  等待预算: 0s
  留证: Vitest `文档角色白名单恰好列出九个 PRD 角色` 输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901070958-avqlef/tests/attempt-run-bridge-guide.test.ts -t "文档角色白名单恰好列出九个 PRD 角色"'

- [ ] [BEHAVIOR] [L2] B-04: payload 必填与可选字段边界明确
  动作: 解析文档「Payload 字段」节
  预期观察: `sprint_dir`、`base_repo`、`branch` 标为必填，`base_sha` 标为可省略且由生产 Brain 自解析
  等待预算: 0s
  留证: Vitest `文档区分三个 payload 必填字段与可省略的 base_sha` 输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901070958-avqlef/tests/attempt-run-bridge-guide.test.ts -t "文档区分三个 payload 必填字段与可省略的 base_sha"'

- [ ] [BEHAVIOR] [L2] B-05: 派发失败回滚链完整可识别
  动作: 阅读失败回滚节并逐项核对三个对象终态
  预期观察: 同时显示 run → `failed`、session → `closed`、task → `cancelled`
  等待预算: 0s
  留证: Vitest `文档说明派发失败的 run session task 完整回滚终态` 输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901070958-avqlef/tests/attempt-run-bridge-guide.test.ts -t "文档说明派发失败的 run session task 完整回滚终态"'

- [ ] [BEHAVIOR] [L2] INV-1: API 鉴权铁律未被文档误导
  动作: 核对说明中的两个端点与鉴权规则
  预期观察: 两端点均关联 `internalAuthOrLoopback`，远端请求要求 Bearer
  等待预算: 0s
  留证: B-02 同一真实文档解析输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901070958-avqlef/tests/attempt-run-bridge-guide.test.ts -t "internalAuthOrLoopback"'

## Invariant N/A 映射

- 凭据安全：由 B-02 验证仅出现环境变量占位名；合同及测试无真实 token。
- 日志脱敏：N/A，本 Sprint 不改日志路径且不处理 PII。
- 分支归属：N/A，本角色使用服务端签发的 propose_branch，未修改 Planner workspace。
- 验证命令：由冻结测试 Red 证据及合同自查实跑覆盖。
- 真环境验证：N/A，纯静态文档无真实调用方接缝。
- 共享文件禁区：由唯一产品 diff ARTIFACT 断言覆盖。
