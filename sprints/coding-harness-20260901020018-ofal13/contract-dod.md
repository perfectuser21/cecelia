---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: attempt-run 桥接使用说明文档

**范围**: 仅新增 `docs/current/attempt-run-bridge-guide.md`；不修改代码、接口或既有文档。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 新增中文说明文档及四个规定章节
  Test: node -e 'const s=require("fs").readFileSync("docs/current/attempt-run-bridge-guide.md","utf8");for(const h of ["## 端点用途与鉴权","## 角色白名单","## payload 字段","## 派发失败自动回滚"])if(!s.includes(h))process.exit(1)'

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L1] B-01: 阅读者能找到两个端点用途与严格鉴权语义
  动作: 打开说明文档并阅读“端点用途与鉴权”一节
  预期观察: POST 被说明为创建/派发，GET 被说明为按 id 查询，宿主或远端必须携带 Bearer token
  等待预算: 0s
  留证: Vitest 输出中“包含两个端点用途与严格鉴权语义”用例结果
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901020018-ofal13/tests/attempt-run-bridge-guide.test.ts -t "包含两个端点用途与严格鉴权语义"'

- [ ] [BEHAVIOR] [L1] B-02: 阅读者只能从严格九项白名单选择角色
  动作: 阅读“角色白名单”一节并逐项抄取角色值
  预期观察: 得到恰好九项且顺序、拼写与 implementation baseline 完全一致
  等待预算: 0s
  留证: Vitest 输出中“角色白名单恰为九项且字面匹配”用例结果
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901020018-ofal13/tests/attempt-run-bridge-guide.test.ts -t "角色白名单恰为九项且字面匹配"'

- [ ] [BEHAVIOR] [L1] B-03: 阅读者能正确组装 payload
  动作: 阅读“payload 字段”一节并区分必填与可省略字段
  预期观察: 仅 sprint_dir、base_repo、branch 被标为必填，base_sha 被标为可省略且由生产 Brain 自解析
  等待预算: 0s
  留证: Vitest 输出中“payload 仅三项必填且 base_sha 可省略”用例结果
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901020018-ofal13/tests/attempt-run-bridge-guide.test.ts -t "payload 仅三项必填且 base_sha 可省略"'

- [ ] [BEHAVIOR] [L1] B-04: 阅读者能识别派发失败的完整收口
  动作: 阅读“派发失败自动回滚”一节并核对三个对象终态
  预期观察: 同一节成组出现 run→failed、session→closed、task→cancelled
  等待预算: 0s
  留证: Vitest 输出中“派发失败回滚三元组完整”用例结果
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901020018-ofal13/tests/attempt-run-bridge-guide.test.ts -t "派发失败回滚三元组完整"'

## Invariant 映射

- INV-1 角色分支：N/A；本 Sprint 不修改或重新签发 planner workspace 分支。

- [ ] [BEHAVIOR] [L1] INV-2: 文档不泄露凭据
  动作: 扫描说明文档中的 Bearer 示例
  预期观察: 只出现环境变量名，不出现疑似 token 字面值
  等待预算: 0s
  留证: node 扫描命令输出与 exit code
  Test: manual:bash -c 'node -e '\''const s=require("fs").readFileSync("docs/current/attempt-run-bridge-guide.md","utf8");if(/Bearer\s+(?!CECELIA_INTERNAL_TOKEN)[A-Za-z0-9._-]{12,}/.test(s))process.exit(1)'\'''

- INV-3 日志脱敏：N/A；本 Sprint 不新增日志、客户隐私、PII 或聊天内容。

- [ ] [BEHAVIOR] [L1] INV-4: 两个端点的鉴权说明不回退
  动作: 阅读“端点用途与鉴权”一节
  预期观察: 两个端点共同声明 internalAuthOrLoopback，且宿主或远端必须携带 Bearer token
  等待预算: 0s
  留证: B-01 冻结测试输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901020018-ofal13/tests/attempt-run-bridge-guide.test.ts -t "包含两个端点用途与严格鉴权语义"'

- [ ] [BEHAVIOR] [L1] INV-5: 环境值不被写死
  动作: 检查说明文档的鉴权示例
  预期观察: 示例从 CECELIA_INTERNAL_TOKEN 环境变量取值，不假设固定 token
  等待预算: 0s
  留证: node 扫描命令输出与 exit code
  Test: manual:bash -c 'node -e '\''const s=require("fs").readFileSync("docs/current/attempt-run-bridge-guide.md","utf8");if(!s.includes("CECELIA_INTERNAL_TOKEN"))process.exit(1)'\'''

- INV-6 真环境验证：N/A；本 Sprint 不修改或声称验证真实环境接缝，仅交付静态说明。
