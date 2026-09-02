---
skeleton: false
journey_type: autonomous
---
# Contract DoD — attempt-run 桥接使用说明

**冻结实现基线**: `d32b864de5adf8d3083c91f31ed3f5f7f58be985`
**范围**: 只新增 `docs/current/attempt-run-bridge-guide.md`，不改产品代码、测试、接口或运行时行为。
**大小**: S

## Invariant 映射

- [语义判定] N/A：不新增通知或写库接口。
- [环境来源] N/A：不读取或改变 target_environment。
- [真实历史] 以冻结基线源码与现有回归测试核对文档内容，不复用历史执行结果。
- [共享禁区] 范围 oracle 明确拒绝共享 CI 或其他产品文件变更。

## ARTIFACT 条目

- [ ] [ARTIFACT] 中文说明文档存在且是唯一产品交付文件
  Test: node -e "const fs=require('fs');const p='docs/current/attempt-run-bridge-guide.md';const s=fs.readFileSync(p,'utf8');if(!/[\u4e00-\u9fff]/.test(s))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 读者看到两个端点用途与远端鉴权
  动作: 打开说明文档并阅读“端点与鉴权”节
  预期观察: POST 派发、GET 查询、internalAuthOrLoopback 与远端 Bearer 要求均明确
  等待预算: 0s
  留证: Vitest 输出中对应 it() 结果
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260902140724-6b5mog/tests/attempt-run-bridge-guide.test.ts -t "文档包含两个端点用途和远端 Bearer 鉴权"'

- [ ] [BEHAVIOR] [L2] B-02: 读者看到封闭的九项角色白名单
  动作: 阅读“角色白名单”节并逐项核对
  预期观察: 恰好九个权威角色，无开放集合或额外角色
  等待预算: 0s
  留证: Vitest 正向集合与替换角色负向样本输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260902140724-6b5mog/tests/attempt-run-bridge-guide.test.ts -t "文档逐项列出且仅列出九个角色白名单"'

- [ ] [BEHAVIOR] [L2] B-03: 读者看到 payload 必填与 base_sha 省略语义
  动作: 阅读“payload”节并核对字段
  预期观察: sprint_dir、base_repo、branch 为必填，base_sha 可省略并由生产 Brain 自解析
  等待预算: 0s
  留证: Vitest 正向语义与“base_sha 必填”负向样本输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260902140724-6b5mog/tests/attempt-run-bridge-guide.test.ts -t "文档说明三个 payload 必填字段和 base_sha 省略语义"'

- [ ] [BEHAVIOR] [L2] B-04: 读者看到派发失败三对象回滚终态
  动作: 阅读“派发失败回滚”节
  预期观察: run→failed、session→closed、task→cancelled 同时出现
  等待预算: 0s
  留证: Vitest 正向三元组与删项负向样本输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260902140724-6b5mog/tests/attempt-run-bridge-guide.test.ts -t "文档说明派发失败后的三对象回滚终态"'

- [ ] [BEHAVIOR] [L2] B-05: 产品差异严格限制为一页中文说明
  动作: 相对冻结实现基线检查产品差异
  预期观察: 排除冻结 sprint 合同后，只剩 docs/current/attempt-run-bridge-guide.md
  等待预算: 0s
  留证: git diff 文件清单；注入非 docs 路径的负向匹配结果
  Test: manual:bash -c 'B=d32b864de5adf8d3083c91f31ed3f5f7f58be985; S=sprints/coding-harness-20260902140724-6b5mog; D=$(git diff --name-only "$B"...HEAD | grep -v "^$S/" || true); [ "$D" = docs/current/attempt-run-bridge-guide.md ]; ! printf "%s\n" packages/brain/src/extra.js | grep -q "^docs/current/"'
