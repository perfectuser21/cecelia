---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: attempt-run 桥接使用说明文档

**范围**: 只新增 `docs/current/attempt-run-bridge-guide.md`，不改代码。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 中文说明文档存在于唯一目标路径，包含四个主题章节
  Test: node -e "const fs=require('fs');const p='docs/current/attempt-run-bridge-guide.md';const s=fs.readFileSync(p,'utf8');for(const x of ['端点用途','鉴权','角色白名单','payload 字段','派发失败自动回滚'])if(!s.includes(x))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L1] B-01: 文档完整覆盖端点、鉴权、九角色、payload 与失败回滚
  动作: 调用方打开桥接说明并依次阅读全部使用章节
  预期观察: 两端点用途、鉴权、九角色、字段规则与三个回滚终态均可直接找到
  等待预算: 0s
  留证: Vitest 输出与文档命中结果
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901020018-ofal13/tests/attempt-run-bridge-guide.test.ts -t "文档完整覆盖端点、鉴权、九角色、payload 与失败回滚"'

- [ ] [BEHAVIOR] [L1] B-02: 宿主与远端鉴权说明不会被误读为免鉴权
  动作: 调用方查阅鉴权章节以准备宿主或远端请求
  预期观察: 文档同时显示 internalAuthOrLoopback 与必须携带 Bearer CECELIA_INTERNAL_TOKEN
  等待预算: 0s
  留证: grep 命令输出与退出码
  Test: manual:bash -c 'DOC=docs/current/attempt-run-bridge-guide.md; grep -q "internalAuthOrLoopback" "$DOC" && grep -q "Bearer CECELIA_INTERNAL_TOKEN" "$DOC" && grep -qE "宿主.*远端.*必须|宿主/远端.*必须" "$DOC"'

- [ ] [BEHAVIOR] [L1] B-03: 九项角色及 payload 必填与可省略边界准确
  动作: 调用方按文档选择角色并组装 POST payload
  预期观察: 九个角色逐项可见，sprint_dir/base_repo/branch 为必填，base_sha 明确可省略且由生产 Brain 解析
  等待预算: 0s
  留证: Node 内容断言输出与退出码
  Test: manual:bash -c 'node -e '\''const fs=require("fs");const s=fs.readFileSync("docs/current/attempt-run-bridge-guide.md","utf8");const rs=["canary","planner","proposer","reviewer","generator","generator-fix","evaluator","evaluator-evidence-repair","judge"];if(!rs.every(r=>s.includes("`"+r+"`"))||!/sprint_dir[\\s\\S]*base_repo[\\s\\S]*branch/.test(s)||!/base_sha[\\s\\S]{0,80}(可省略|选填)/.test(s)||!/生产 Brain[\\s\\S]{0,80}(解析|补全)/.test(s))process.exit(1)'\'''

- [ ] [BEHAVIOR] [L1] B-04: 派发失败三个对象自动回滚成组可识别
  动作: 调用方阅读失败回滚章节以判断派发失败后的收口状态
  预期观察: run→failed、session→closed、task→cancelled 在同一章节按组出现
  等待预算: 0s
  留证: grep 命令退出码
  Test: manual:bash -c 'DOC=docs/current/attempt-run-bridge-guide.md; grep -q "^## .*派发失败自动回滚" "$DOC" && grep -qE "run.*failed.*session.*closed.*task.*cancelled" "$DOC"'

- [ ] [BEHAVIOR] [L1] B-05: 实现交付仅新增目标中文文档且不改代码
  动作: 验收者相对冻结 implementation baseline 检查候选变更范围
  预期观察: 排除本 sprint 冻结合同产物后，仅目标 docs/current 文档发生变化
  等待预算: 0s
  留证: git diff 文件清单
  Test: manual:bash -c 'BASE=18cc9dae0611554b6f38ae0239c591449a259229; SPRINT=sprints/coding-harness-20260901020018-ofal13/; git diff --name-only "$BASE"...HEAD | awk -v sprint="$SPRINT" '\''index($0,sprint)!=1{print}'\'' | diff -u <(printf "%s\\n" docs/current/attempt-run-bridge-guide.md) -'

## Invariant 映射

- [角色分支] N/A：本 sprint 不修改或切换 Planner workspace；Proposer 使用服务端签发分支。
- [凭据安全] 由 B-02 覆盖：只写环境变量名，不写 token 值。
- [日志脱敏] N/A：本 sprint 不新增日志或运行时代码。
- [端点鉴权] 由 B-02 覆盖：文档明确既有鉴权，不修改端点。
- [环境假设] N/A：静态文档不写环境坐标或校准值。
- [真环境验证] N/A：本 sprint 不改变真实环境接缝，仅记录冻结 baseline 的既有合同。
