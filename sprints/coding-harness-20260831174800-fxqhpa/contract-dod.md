---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge-guide.md`
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 中文说明文档位于固定路径且含四个约定章节
  Test: node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-guide.md','utf8');for(const h of ['## 端点用途','## 鉴权方式','## 角色白名单与 payload','## 派发失败自动回滚'])if(!s.includes(h))process.exit(1)"

- [ ] [ARTIFACT] 交付 diff 不含目标文档与本 sprint 合同产物之外的文件
  Test: bash -c "git diff --name-only f4f1f511f854ec6fdc0a8512bfe9183181be3fb9...HEAD | grep -Ev '^(docs/current/attempt-run-bridge-guide\\.md|sprints/coding-harness-20260831174800-fxqhpa/)' && exit 1 || exit 0"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 读者从文档识别两个端点用途
  动作: 打开 attempt-run 桥接说明并阅读「端点用途」节
  预期观察: POST 被说明为创建并派发，GET 被说明为按 id 查询运行状态
  等待预算: 0s
  留证: Vitest verbose 输出中对应测试为 PASS
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260831174800-fxqhpa/tests/attempt-run-bridge-guide.test.ts -t "两个端点用途与 internalAuthOrLoopback 鉴权说明完整"'

- [ ] [BEHAVIOR] [L2] B-02: 读者区分 loopback 与宿主远端鉴权
  动作: 阅读「鉴权方式」节并查找宿主或远端请求格式
  预期观察: 文档同时给出 internalAuthOrLoopback 与 Authorization Bearer CECELIA_INTERNAL_TOKEN，且不声称远端免鉴权
  等待预算: 0s
  留证: Vitest verbose 输出中鉴权断言为 PASS
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260831174800-fxqhpa/tests/attempt-run-bridge-guide.test.ts -t "两个端点用途与 internalAuthOrLoopback 鉴权说明完整"'

- [ ] [BEHAVIOR] [L2] B-03: 读者取得九项角色与 payload 规则
  动作: 阅读「角色白名单与 payload」节并逐项核对角色和字段
  预期观察: 九项角色精确列全，三个字段标为必填，base_sha 标为可省略且由生产 Brain 自解析
  等待预算: 0s
  留证: Vitest verbose 输出中角色与 payload 测试为 PASS
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260831174800-fxqhpa/tests/attempt-run-bridge-guide.test.ts -t "角色白名单精确列出九项且 payload 必填与 base_sha 省略语义正确"'

- [ ] [BEHAVIOR] [L2] B-04: 读者确认派发失败后全部对象已收敛
  动作: 阅读「派发失败自动回滚」节并核对 run、session、task
  预期观察: 文档明确 run → failed、session → closed、task → cancelled，说明不再执行
  等待预算: 0s
  留证: Vitest verbose 输出中三对象回滚测试为 PASS
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260831174800-fxqhpa/tests/attempt-run-bridge-guide.test.ts -t "派发失败回滚同时收敛 run session task 三类状态"'

## Invariant 映射

- [ ] [BEHAVIOR] [L2] INV-1: 权威实现基线不被角色 checkout 替换
  动作: 核对合同中记录的权威实现基线
  预期观察: 合同使用 inputs.implementation_baseline 的 f4f1f511 值且范围检查以该 SHA 为起点
  等待预算: 0s
  留证: 命令输出 `OK: baseline anchored`
  Test: manual:bash -c 'node -e "const s=require(\"fs\").readFileSync(\"sprints/coding-harness-20260831174800-fxqhpa/contract-draft.md\",\"utf8\");if(!s.includes(\"f4f1f511f854ec6fdc0a8512bfe9183181be3fb9\"))process.exit(1)"; echo "OK: baseline anchored"'
