---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge-guide.md` 中文说明页。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 新增说明文档位于约定路径，且合同冻结测试已提交
  Test: node -e "const fs=require('fs');for(const p of ['docs/current/attempt-run-bridge-guide.md','sprints/coding-harness-20260831142046-muda2u/tests/attempt-run-bridge-guide.test.ts']){if(!fs.existsSync(p))process.exit(1)}"

## Invariant 覆盖

- [端点鉴权] INV-1：由 B-02 精确断言 `internalAuthOrLoopback` 与远端 Bearer 要求。
- [凭据安全] INV-2：文档只能出现变量名 `CECELIA_INTERNAL_TOKEN`，不得出现 token 实值；由范围审查与 B-02 覆盖。
- [Planner 分支] N/A：本 Sprint 不修改 Planner workspace 或分支签发逻辑。
- [真实验证] N/A：纯文档改动，无真实调用方执行接缝。
- [禁止写死] INV-3：权威实施基线来自 bundle，验收命令使用固定稳定 base SHA；不写死运行时身份或环境秘密。

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 文档位于 docs/current 且为中文说明
  动作: 从仓库根读取新增的 attempt-run 桥接说明。
  预期观察: 文档存在、标题准确且正文包含中文。
  等待预算: 0s
  留证: Vitest verbose 输出中的用例结果。
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260831142046-muda2u/tests/attempt-run-bridge-guide.test.ts -t "文档位于 docs/current 且为中文说明"'

- [ ] [BEHAVIOR] [L2] B-02: 两个端点用途与 internalAuthOrLoopback 鉴权说明完整
  动作: 阅读端点与鉴权章节并核对发起、查询及远端认证要求。
  预期观察: POST/GET 用途、internalAuthOrLoopback 与 Bearer token 变量名同时出现。
  等待预算: 0s
  留证: Vitest verbose 输出中的用例结果。
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260831142046-muda2u/tests/attempt-run-bridge-guide.test.ts -t "两个端点用途与 internalAuthOrLoopback 鉴权说明完整"'

- [ ] [BEHAVIOR] [L2] B-03: 角色白名单完整列出九项且没有额外角色
  动作: 从独立角色白名单章节提取所有反引号列表项。
  预期观察: 提取结果与服务端九项 ALLOWED_ROLES 精确相等。
  等待预算: 0s
  留证: Vitest 数组精确相等断言输出。
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260831142046-muda2u/tests/attempt-run-bridge-guide.test.ts -t "角色白名单完整列出九项且没有额外角色"'

- [ ] [BEHAVIOR] [L2] B-04: payload 必填字段与 base_sha 省略语义完整
  动作: 阅读 payload 章节并核对字段要求。
  预期观察: sprint_dir、base_repo、branch 均标为必填；base_sha 标为可省略并由生产 Brain 自解析。
  等待预算: 0s
  留证: Vitest 字段语义断言输出。
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260831142046-muda2u/tests/attempt-run-bridge-guide.test.ts -t "payload 必填字段与 base_sha 省略语义完整"'

- [ ] [BEHAVIOR] [L2] B-05: 派发失败自动回滚三层状态完整
  动作: 阅读派发失败章节并核对三层收口状态。
  预期观察: run→failed、session→closed、task→cancelled 三项同时出现。
  等待预算: 0s
  留证: Vitest 三项状态断言输出。
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260831142046-muda2u/tests/attempt-run-bridge-guide.test.ts -t "派发失败自动回滚三层状态完整"'
