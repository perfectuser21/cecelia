---
skeleton: false
journey_type: dev_pipeline
---
# Contract DoD — Sprint: attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge-guide.md` 中文文档
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 中文说明文档位于约定路径，且实现提交不修改生产代码
  Test: bash -c 'grep -q "POST /api/brain/harness/attempt-run" docs/current/attempt-run-bridge-guide.md && [ -z "$(git diff --name-only 5c12d2af68e2b2e4b8dcaaa2c87e50efab743291...HEAD -- packages apps scripts | sed "/^$/d")" ]'

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L1] B-01: 维护者读到两个端点用途与远端 Bearer 鉴权
  动作: 打开中文说明并查阅“端点用途与鉴权”一节
  预期观察: 同时看到 POST 派发、GET 轮询、internalAuthOrLoopback 与宿主/远端 Bearer token 写法
  等待预算: 0s
  留证: Vitest 输出中指定用例 PASS
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260831071930-g9wcma/tests/attempt-run-bridge-guide.test.ts -t "说明 POST 与 GET 两个端点用途和 Bearer 鉴权"'

- [ ] [BEHAVIOR] [L1] B-02: 维护者读到完整九项角色白名单
  动作: 打开中文说明并逐项核对白名单
  预期观察: 九个允许角色均以源码字面名称出现
  等待预算: 0s
  留证: Vitest 输出中指定用例 PASS
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260831071930-g9wcma/tests/attempt-run-bridge-guide.test.ts -t "逐项列出九项角色白名单"'

- [ ] [BEHAVIOR] [L1] B-03: 维护者读到 payload 最小字段与 base_sha 省略语义
  动作: 打开中文说明并按字段表构造 payload
  预期观察: sprint_dir、base_repo、branch 标为必填，base_sha 标为可省略且由生产 Brain 解析
  等待预算: 0s
  留证: Vitest 输出中指定用例 PASS
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260831071930-g9wcma/tests/attempt-run-bridge-guide.test.ts -t "说明 payload 三个必填字段与 base_sha 省略语义"'

- [ ] [BEHAVIOR] [L1] B-04: 维护者读到派发失败自动回滚映射
  动作: 打开中文说明并查阅“派发失败自动回滚”一节
  预期观察: run→failed、session→closed、task→cancelled 三项映射完整可见
  等待预算: 0s
  留证: Vitest 输出中指定用例 PASS
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260831071930-g9wcma/tests/attempt-run-bridge-guide.test.ts -t "说明派发失败自动回滚的三项终态"'

## Invariant 映射

- N/A：bundle 未注入额外铁律清单；仓库硬规则由 ARTIFACT 条目锁定“仅新增文档、不改代码”。
