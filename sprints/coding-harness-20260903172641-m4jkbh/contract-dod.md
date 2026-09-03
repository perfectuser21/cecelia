---
skeleton: false
journey_type: autonomous
---
# Contract DoD — attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge-usage.md` 中文文档。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 指定中文文档存在且非空
  Test: node -e "const fs=require('fs');const p='docs/current/attempt-run-bridge-usage.md';if(!fs.existsSync(p)||fs.readFileSync(p,'utf8').trim().length===0)process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 中文文档存在且四节齐全
  动作: 从仓库根运行冻结测试并读取新增说明文档
  预期观察: 中文说明存在，端点与鉴权、角色白名单、payload、失败回滚四节齐全；缺节反例被拒绝
  等待预算: 0s
  留证: Vitest verbose 输出中的 B-01 用例结果
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260903172641-m4jkbh/tests/attempt-run-bridge-usage.test.ts -t "中文文档存在且四节齐全"'

- [ ] [BEHAVIOR] [L2] B-02: 两个端点用途与鉴权边界
  动作: 对说明中的 POST、GET、loopback 与宿主/远端认证字面运行正向及负向 oracle
  预期观察: 两端点用途准确，远端必须 Bearer；缺端点或误写远端免鉴权均失败
  等待预算: 0s
  留证: Vitest verbose 输出中的 B-02 用例结果
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260903172641-m4jkbh/tests/attempt-run-bridge-usage.test.ts -t "两个端点用途与鉴权边界"'

- [ ] [BEHAVIOR] [L2] B-03: 九项角色是封闭集合且 payload 必填集合准确
  动作: 解析文档代码清单并与九角色、三个必填字段的封闭集合逐项比较
  预期观察: 九角色无缺失无额外项；`base_sha` 仅为可省略字段；缺项、增项和误列必填均失败
  等待预算: 0s
  留证: Vitest verbose 输出中的 B-03 用例结果
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260903172641-m4jkbh/tests/attempt-run-bridge-usage.test.ts -t "九项角色是封闭集合且 payload 必填集合准确"'

- [ ] [BEHAVIOR] [L2] B-04: 派发失败三段回滚终态完整
  动作: 解析失败回滚清单并与三个对象终态的封闭集合比较
  预期观察: `run→failed`、`session→closed`、`task→cancelled` 同时且仅此三项；缺项或增项均失败
  等待预算: 0s
  留证: Vitest verbose 输出中的 B-04 用例结果
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260903172641-m4jkbh/tests/attempt-run-bridge-usage.test.ts -t "派发失败三段回滚终态完整"'

- [ ] [BEHAVIOR] [L2] B-05: 实现范围仅允许指定文档
  动作: 从冻结 BASE_SHA 比较 HEAD，并排除合同所在 Sprint 产物后核对产品路径
  预期观察: 唯一产品变更为说明文档；缺文档、额外文档或任意代码变更均失败
  等待预算: 0s
  留证: git diff 路径清单与 Vitest B-05 输出
  Test: manual:bash -c 'BASE_SHA='"'"'7404b42722835094b457b55f092cd76139ce131e'"'"'; ALLOWED='"'"'docs/current/attempt-run-bridge-usage.md'"'"'; ACTUAL=$(git diff --name-only "$BASE_SHA"...HEAD -- . '"'"':(exclude)sprints/**'"'"'); [ "$ACTUAL" = "$ALLOWED" ]'

## Invariant 映射

- INV-1 端点鉴权：B-02 同时要求 `internalAuthOrLoopback` 与宿主/远端 Bearer，并含误写免鉴权的负向 oracle。
- INV-2 凭据安全：仅记录变量名 `CECELIA_INTERNAL_TOKEN`，禁止出现 token 值；B-02 负向 oracle 拒绝示例 token 字面。
- INV-3 分支权威：N/A，本 Sprint 不改变 Planner 分支或分支选择逻辑。
- INV-4 验证命令：B-01 至 B-05 均为可执行命令，失败以非零 exit code 传播。
- INV-5 真环境验证：N/A，纯静态文档且不改真实调用方接缝。
