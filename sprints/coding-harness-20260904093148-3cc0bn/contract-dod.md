---
skeleton: false
journey_type: autonomous
---
# Contract DoD — attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge-guide.md`；Sprint 冻结合同与测试为验收资产，不属于产品实现。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 中文说明文件存在且正文非空
  Test: node -e "const fs=require('fs');const p='docs/current/attempt-run-bridge-guide.md';const s=fs.readFileSync(p,'utf8');if(!/[\u4e00-\u9fff]/u.test(s))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 中文文档恰有四节
  动作: 解析说明中的全部二级标题
  预期观察: 四节逐项存在，任意第五节被拒绝
  等待预算: 0s
  留证: Vitest 输出
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260904093148-3cc0bn/tests/attempt-run-bridge-guide.test.ts -t "中文文档包含四节且不存在第五个一级主题节"'

- [ ] [BEHAVIOR] [L2] B-02: 两个端点形成封闭集合
  动作: 解析文档中的 method 与 attempt-run path
  预期观察: POST 创建、GET 查询逐项存在，任意第三端点被拒绝
  等待预算: 0s
  留证: Vitest 输出
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260904093148-3cc0bn/tests/attempt-run-bridge-guide.test.ts -t "两个端点逐项存在且机械拒绝任意第三端点"'

- [ ] [BEHAVIOR] [L2] B-03: 鉴权正向与负向规则成对成立
  动作: 检查中间件名、Bearer 形式与无令牌禁令
  预期观察: 宿主或远端必须带 CECELIA_INTERNAL_TOKEN，不能借 loopback 规则免鉴权
  等待预算: 0s
  留证: Vitest 输出
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260904093148-3cc0bn/tests/attempt-run-bridge-guide.test.ts -t "鉴权正向要求与远端无令牌负向禁令成对存在"'

- [ ] [BEHAVIOR] [L2] B-04: 九个角色形成封闭集合
  动作: 逐项解析角色列表并现场计数
  预期观察: 恰好九项全部存在，任意第十角色被机械拒绝
  等待预算: 0s
  留证: Vitest 输出
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260904093148-3cc0bn/tests/attempt-run-bridge-guide.test.ts -t "九个角色逐项存在且机械拒绝任意第十角色"'

- [ ] [BEHAVIOR] [L2] B-05: payload 与回滚各自形成封闭集合
  动作: 逐项解析必填字段、base_sha 省略语义及回滚状态
  预期观察: 必填字段恰好三项且拒绝第四项；回滚终态恰好三项且拒绝额外状态
  等待预算: 0s
  留证: Vitest 输出
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260904093148-3cc0bn/tests/attempt-run-bridge-guide.test.ts -t "三个必填字段与三个回滚终态分别构成封闭集合"'

- [ ] [BEHAVIOR] [L2] INV-1: 实现基线与产品改动范围保持不变
  动作: 从冻结 base SHA 计算候选变更路径
  预期观察: 产品实现只新增指定 docs/current 中文页，合同资产仅位于本 sprint
  等待预算: 0s
  留证: git diff 路径输出
  Test: manual:bash -c 'BASE_SHA=033e0feae6474eff023a3974a94a17ad0a6a53b9; CHANGED=$(git diff --name-only "$BASE_SHA"...HEAD); EXPECTED=$(printf "%s\n" docs/current/attempt-run-bridge-guide.md sprints/coding-harness-20260904093148-3cc0bn/contract-draft.md sprints/coding-harness-20260904093148-3cc0bn/contract-dod.md sprints/coding-harness-20260904093148-3cc0bn/tests/attempt-run-bridge-guide.test.ts | sort); [ "$(printf "%s\n" "$CHANGED" | sed "/^$/d" | sort)" = "$EXPECTED" ]'

## Invariant 映射

- 分支归属：N/A，本角色使用服务端签发 proposer 分支，未切换。
- 实现基线：由 INV-1 将 `033e0feae6474eff023a3974a94a17ad0a6a53b9` 写死并校验。
- 凭据安全：文档只能出现变量名 `CECELIA_INTERNAL_TOKEN`，不得出现令牌值。
- 端点鉴权：由 B-03 同时校验正向 Bearer 要求与负向无令牌禁令。
- 真环境验证：N/A，本单为静态文档，不改真实接缝行为。
