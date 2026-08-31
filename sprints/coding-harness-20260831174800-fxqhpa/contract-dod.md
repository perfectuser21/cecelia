---
skeleton: false
journey_type: dev_pipeline
---
# Contract DoD — attempt-run 桥接使用说明

**范围**：仅新增 `docs/current/attempt-run-bridge-guide.md`
**大小**：S

## ARTIFACT 条目

- [ ] [ARTIFACT] 新增简体中文说明文档，且相对实现基线无代码文件改动
  Test: `bash -c 'test -f docs/current/attempt-run-bridge-guide.md; git diff --name-only 88929fa377f5bed3cd1876a575c366ff1b93c0d5...HEAD | grep -qx docs/current/attempt-run-bridge-guide.md; ! git diff --name-only 88929fa377f5bed3cd1876a575c366ff1b93c0d5...HEAD | grep -E "^(packages|apps|scripts)/"'`

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01：读者可按文档识别两个端点用途与鉴权方式
  动作：打开桥接说明的“端点用途与鉴权”一节，核对 POST、GET 与调用位置要求
  预期观察：POST 被描述为异步派发，GET 被描述为按 attempt id 轮询；宿主/远端需 Bearer token
  等待预算：0s
  留证：helper 命令标准输出
  Test: manual:bash -c 'node sprints/coding-harness-20260831174800-fxqhpa/tests/attempt-run-bridge-doc.test-helper.cjs endpoints'

- [ ] [BEHAVIOR] [L2] B-02：读者可从文档获得完整九项角色白名单
  动作：打开“角色白名单”一节并逐项读取角色名
  预期观察：九项源码角色全部出现，且文档明确名单外角色会被拒绝
  等待预算：0s
  留证：helper 命令标准输出
  Test: manual:bash -c 'node sprints/coding-harness-20260831174800-fxqhpa/tests/attempt-run-bridge-doc.test-helper.cjs roles'

- [ ] [BEHAVIOR] [L2] B-03：读者可构造最小 payload
  动作：打开“payload 字段”一节，读取必填字段和 base_sha 规则
  预期观察：sprint_dir、base_repo、branch 标为必填，base_sha 标为可省略并由生产 Brain 自解析
  等待预算：0s
  留证：helper 命令标准输出
  Test: manual:bash -c 'node sprints/coding-harness-20260831174800-fxqhpa/tests/attempt-run-bridge-doc.test-helper.cjs payload'

- [ ] [BEHAVIOR] [L2] B-04：读者可理解派发失败的原子回滚结果
  动作：打开“派发失败自动回滚”一节，读取三个资源的终态
  预期观察：文档明确 run→failed、session→closed、task→cancelled
  等待预算：0s
  留证：helper 命令标准输出
  Test: manual:bash -c 'node sprints/coding-harness-20260831174800-fxqhpa/tests/attempt-run-bridge-doc.test-helper.cjs rollback'

