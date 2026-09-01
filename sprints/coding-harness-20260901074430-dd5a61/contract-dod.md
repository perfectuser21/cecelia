---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge-guide.md` 中文说明页，不修改代码。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 中文说明页位于约定路径且标题正确
  Test: node -e "const fs=require('fs');const p='docs/current/attempt-run-bridge-guide.md';const s=fs.readFileSync(p,'utf8');if(!s.startsWith('# attempt-run 桥接使用说明')||!/[\u4e00-\u9fff]/.test(s))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 创建查询与远端鉴权说明完整
  动作: 打开说明页，依次阅读创建、查询和鉴权章节。
  预期观察: 两个端点用途可区分，且宿主/远端 Bearer 约束明确。
  等待预算: 0s
  留证: 命令输出中保留命中的四项关键字。
  Test: manual:bash -c 'DOC=docs/current/attempt-run-bridge-guide.md; grep -q "POST /api/brain/harness/attempt-run" "$DOC" && grep -q "GET /api/brain/harness/attempt-run/:id" "$DOC" && grep -q "internalAuthOrLoopback" "$DOC" && grep -q "Bearer CECELIA_INTERNAL_TOKEN" "$DOC"'

- [ ] [BEHAVIOR] [L2] B-02: 九项角色白名单精确且不增不减
  动作: 阅读角色白名单章节并逐项与生产 ALLOWED_ROLES 核对。
  预期观察: 九个独立条目按生产顺序出现，无别名、遗漏或额外角色。
  等待预算: 0s
  留证: 输出解析后的单行角色序列。
  Test: manual:bash -c 'DOC=docs/current/attempt-run-bridge-guide.md; EXPECTED="canary planner proposer reviewer generator generator-fix evaluator evaluator-evidence-repair judge"; ACTUAL=$(awk '\''/^## .*角色白名单/{on=1;next} on&&/^## /{on=0} on&&/^- `[^`]+`/{gsub(/^- `|`.*$/," ");gsub(/^ | $/,"");print}'\'' "$DOC" | paste -sd" " -); echo "$ACTUAL"; test "$ACTUAL" = "$EXPECTED"'

- [ ] [BEHAVIOR] [L2] B-03: payload 必填与 base_sha 省略语义完整
  动作: 阅读 payload 章节，区分调用方必填与 Brain 自解析字段。
  预期观察: `sprint_dir`、`base_repo`、`branch` 标为必填；`base_sha` 标为可省略并由生产 Brain 自解析。
  等待预算: 0s
  留证: 命令输出或失败字段名。
  Test: manual:bash -c 'DOC=docs/current/attempt-run-bridge-guide.md; grep -Eq "sprint_dir.*(必填|required)" "$DOC" && grep -Eq "base_repo.*(必填|required)" "$DOC" && grep -Eq "branch.*(必填|required)" "$DOC" && grep -Eq "base_sha.*(可省略|非必填)" "$DOC" && grep -Eq "生产 Brain.*(自解析|解析)" "$DOC"'

- [ ] [BEHAVIOR] [L2] B-04: 派发失败三对象回滚终态完整
  动作: 阅读派发失败自动回滚章节，核对 run、session、task 三个对象。
  预期观察: 文档同时显示 `run→failed`、`session→closed`、`task→cancelled`。
  等待预算: 0s
  留证: 命令输出中保留三个终态断言结果。
  Test: manual:bash -c 'DOC=docs/current/attempt-run-bridge-guide.md; grep -q "^## .*派发失败.*回滚" "$DOC" && grep -Eq "run.*(→|->).*failed" "$DOC" && grep -Eq "session.*(→|->).*closed" "$DOC" && grep -Eq "task.*(→|->).*cancelled" "$DOC"'

## Invariant 覆盖

- [ ] [BEHAVIOR] [L2] INV-1: Planner 分支与实现范围保持隔离
  动作: 从实现基线检查产品变更文件集合。
  预期观察: 除 Sprint 治理产物外，仅新增约定文档，不出现代码变更。
  等待预算: 0s
  留证: `git diff --name-only` 输出。
  Test: manual:bash -c 'CHANGED=$(git diff --name-only de47c2d8b164a09ea5470eb9948ad6e8b2cf6ba1...HEAD | awk '\''index($0,"sprints/coding-harness-20260901074430-dd5a61/")!=1'\''); echo "$CHANGED"; test "$CHANGED" = "docs/current/attempt-run-bridge-guide.md"'
- [ ] [BEHAVIOR] [L2] INV-2: 凭据安全不泄露 token 值
  动作: 检查说明页只引用环境变量名，不出现看似实际 token 的赋值或 Bearer 值。
  预期观察: 存在 `CECELIA_INTERNAL_TOKEN` 占位说明，且无 `Bearer` 后跟实际长凭据。
  等待预算: 0s
  留证: 扫描命令退出码。
  Test: manual:bash -c 'DOC=docs/current/attempt-run-bridge-guide.md; grep -q "CECELIA_INTERNAL_TOKEN" "$DOC"; if grep -Eq "Bearer [A-Za-z0-9_-]{24,}" "$DOC"; then exit 1; fi'
- [ ] [BEHAVIOR] [L2] INV-3: 端点鉴权约束未回退
  动作: 核对两个端点的文档鉴权说明。
  预期观察: 明确 `internalAuthOrLoopback`，且宿主和远端均必须携带 Bearer token。
  等待预算: 0s
  留证: 关键字断言输出。
  Test: manual:bash -c 'DOC=docs/current/attempt-run-bridge-guide.md; grep -q "internalAuthOrLoopback" "$DOC" && grep -Eq "(宿主|远端).*(必须|须).*Bearer CECELIA_INTERNAL_TOKEN" "$DOC"'
- [ ] [BEHAVIOR] [L2] INV-4: 禁止环境假设并保留生产解析语义
  动作: 检查文档对 `base_sha` 的来源描述。
  预期观察: 文档不写死 SHA，明确省略时由生产 Brain 自解析。
  等待预算: 0s
  留证: 语义断言与 SHA 字面扫描退出码。
  Test: manual:bash -c 'DOC=docs/current/attempt-run-bridge-guide.md; grep -Eq "base_sha.*(可省略|非必填)" "$DOC" && grep -Eq "生产 Brain.*(自解析|解析)" "$DOC"; if grep -Eq "[a-f0-9]{40}" "$DOC"; then exit 1; fi'
- [ ] [BEHAVIOR] [L2] INV-5: 真实验证约束映射到冻结源码事实
  动作: 运行 Sprint 冻结测试，直接读取生产路由常量并对文档做对照。
  预期观察: 冻结测试通过，文档角色集合与生产 `ALLOWED_ROLES` 一致。
  等待预算: 30s
  留证: Vitest verbose 输出。
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901074430-dd5a61/tests/attempt-run-bridge-guide.test.ts --reporter=verbose'
