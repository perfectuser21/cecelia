---
skeleton: false
journey_type: dev_pipeline
---
# Contract DoD — attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge-guide.md`，不改代码。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 中文说明文档位于 `docs/current/attempt-run-bridge-guide.md`，包含“端点用途”“鉴权”“角色白名单”“payload 字段”“失败回滚”四类内容。
  Test: node -e "const fs=require('fs');const p='docs/current/attempt-run-bridge-guide.md';const s=fs.readFileSync(p,'utf8');if(!s.includes('# attempt-run 桥接使用说明'))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L1] B-01: 读者可确认两个端点用途与鉴权方式
  动作: 打开说明文档，阅读“端点用途与鉴权”一节
  预期观察: POST 被说明为异步派发，GET 被说明为轮询结果，远端 Bearer 鉴权写法完整
  等待预算: 0s
  留证: Vitest 输出中“说明两个端点用途与鉴权方式”通过
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260831211658-evkes3/tests/attempt-run-bridge-guide.test.ts -t "说明两个端点用途与鉴权方式"'

- [ ] [BEHAVIOR] [L1] B-02: 读者可从白名单选择九项合法角色
  动作: 阅读“角色白名单”一节并逐项核对角色名
  预期观察: 九项角色不重不漏，连字符与生产常量一致
  等待预算: 0s
  留证: Vitest 输出中“完整列出九项角色白名单”通过
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260831211658-evkes3/tests/attempt-run-bridge-guide.test.ts -t "完整列出九项角色白名单"'

- [ ] [BEHAVIOR] [L1] B-03: 读者可正确组装 payload
  动作: 阅读“payload 字段”一节并核对请求示例
  预期观察: sprint_dir、base_repo、branch 标为必填，base_sha 标为可省略且由生产 Brain 解析
  等待预算: 0s
  留证: Vitest 输出中“说明 payload 必填字段与 base_sha 省略规则”通过
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260831211658-evkes3/tests/attempt-run-bridge-guide.test.ts -t "说明 payload 必填字段与 base_sha 省略规则"'

- [ ] [BEHAVIOR] [L1] B-04: 读者可识别派发失败后的资源终态
  动作: 阅读“派发失败自动回滚”一节
  预期观察: run→failed、session→closed、task→cancelled 三组映射清楚可见
  等待预算: 0s
  留证: Vitest 输出中“说明派发失败自动回滚的三个终态”通过
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260831211658-evkes3/tests/attempt-run-bridge-guide.test.ts -t "说明派发失败自动回滚的三个终态"'

- [ ] [BEHAVIOR] [L1] B-05: 实现变更不越出 docs/current 目标文件
  动作: 对权威实现基线与候选 HEAD 执行路径差异检查
  预期观察: 除本 Sprint 合同产物外，仅目标说明文档发生变化
  等待预算: 0s
  留证: Vitest 输出中“实现范围仅含目标文档”通过
  Test: manual:bash -c 'BASE_SHA=88929fa377f5bed3cd1876a575c366ff1b93c0d5 npx vitest run --no-cache sprints/coding-harness-20260831211658-evkes3/tests/attempt-run-bridge-guide.test.ts -t "实现范围仅含目标文档"'

## Invariant 映射

- [ ] [BEHAVIOR] [L1] INV-1: 不修改 `packages/brain`，因此不触发 Brain 版本与 DevGate 变更义务
  动作: 检查权威实现基线到候选 HEAD 的路径集合
  预期观察: `packages/brain/` 无任何变更
  等待预算: 0s
  留证: git diff 路径输出为空
  Test: manual:bash -c 'test -z "$(git diff --name-only 88929fa377f5bed3cd1876a575c366ff1b93c0d5...HEAD -- packages/brain)"'

