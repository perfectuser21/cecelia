---
skeleton: false
journey_type: autonomous
---
# Contract DoD — attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge-guide.md`
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 中文目标文档存在且包含四个约定章节
  Test: node -e "const fs=require('fs');const p='docs/current/attempt-run-bridge-guide.md';const s=fs.readFileSync(p,'utf8');for(const h of ['## 端点用途','## 鉴权','## 角色白名单','## Payload','## 派发失败自动回滚'])if(!s.includes(h))process.exit(1);if(!/[一-龥]/.test(s))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L1] B-01: 读者能确认两个端点及各自用途
  动作: 打开说明页并阅读端点用途章节
  预期观察: POST 被说明为异步派发或创建，GET 被说明为按 id 查询或轮询结果
  等待预算: 0s
  留证: Vitest 输出中对应断言结果
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260902140724-6b5mog/tests/attempt-run-bridge-guide.test.ts -t "包含两个端点及各自用途"'

- [ ] [BEHAVIOR] [L1] B-02: 读者能按远端鉴权并只选九项白名单角色
  动作: 阅读鉴权与角色白名单章节
  预期观察: 宿主或远端需 Bearer token，且角色集合恰好为生产实现九项
  等待预算: 0s
  留证: Vitest 输出中正向集合与禁止角色反向断言
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260902140724-6b5mog/tests/attempt-run-bridge-guide.test.ts -t "角色白名单恰好是九项封闭集合"'

- [ ] [BEHAVIOR] [L1] B-03: 读者不会把 base_sha 当作必填
  动作: 阅读 Payload 章节并准备 POST body
  预期观察: sprint_dir、base_repo、branch 为必填，base_sha 可省略并由生产 Brain 自解析
  等待预算: 0s
  留证: Vitest 输出中必填正向与 base_sha 必填负向断言
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260902140724-6b5mog/tests/attempt-run-bridge-guide.test.ts -t "payload 必填字段且 base_sha 可省略"'

- [ ] [BEHAVIOR] [L1] B-04: 读者能完整识别派发失败回滚
  动作: 阅读派发失败自动回滚章节
  预期观察: 同时看到 run→failed、session→closed、task→cancelled
  等待预算: 0s
  留证: Vitest 输出中三个状态对的逐项断言
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260902140724-6b5mog/tests/attempt-run-bridge-guide.test.ts -t "派发失败自动回滚三个对象"'

- [ ] [BEHAVIOR] [L1] B-05: 候选实现范围只有目标说明页
  动作: 相对冻结实现基线检查候选 HEAD 的文件集合
  预期观察: 排除本 sprint 合同治理产物后，差异严格只有目标文档且无代码文件
  等待预算: 0s
  留证: canonical git diff 文件列表与 Vitest 输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260902140724-6b5mog/tests/attempt-run-bridge-guide.test.ts -t "实现范围只有目标说明文档"'

## Invariant 映射

- [ ] [BEHAVIOR] [L1] INV-1 语义判定：文档验收检查端点用途、精确角色、字段义务和三个回滚终态，不以 `ok:true` 代替语义验证。
  动作: 执行完整冻结测试
  预期观察: 所有语义断言逐项通过
  等待预算: 0s
  留证: Vitest 完整输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260902140724-6b5mog/tests/attempt-run-bridge-guide.test.ts'
- N/A：[环境来源] 本 sprint 不读取或修改 `target_environment`。
- N/A：[真实历史] 本 sprint 不复用历史合同执行断言，仅验证当前候选文档。
- [ ] [BEHAVIOR] [L1] INV-4 共享禁区：相对冻结基线无代码或共享 CI 变更。
  动作: 执行冻结基线范围测试
  预期观察: 实现 diff 严格等于目标说明页
  等待预算: 0s
  留证: git diff 文件列表
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260902140724-6b5mog/tests/attempt-run-bridge-guide.test.ts -t "实现范围只有目标说明文档"'

