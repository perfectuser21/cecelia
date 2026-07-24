---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Kernel v1 mixed provider 主链 fire drill r4

**范围**: 仅新增 docs/fire-drills/kernel-v1-mixed-20260724-r4.md（PR diff 恰一行）；禁改 packages/brain、现有合同测试、迁移、产品逻辑；sprints/**、.harness/** 禁入 PR
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] docs/fire-drills/kernel-v1-mixed-20260724-r4.md 存在
  Test: node -e "require('fs').accessSync('docs/fire-drills/kernel-v1-mixed-20260724-r4.md')"

- [ ] [ARTIFACT] 文档含三项字面要素（PASS_R4 标记 / 生产版本 / merge commit）
  Test: node -e "const c=require('fs').readFileSync('docs/fire-drills/kernel-v1-mixed-20260724-r4.md','utf8');for(const k of['KERNEL_V1_MIXED_FIRE_DRILL_PASS_R4','1.267.67','19887912bbb581597f12c714a9ed187f051e2850'])if(!c.includes(k))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，journey_type = autonomous，全部在 generator 分支工作区 repo 根目录执行）

- [ ] [BEHAVIOR] [L2] 目标文档存在且含标记 KERNEL_V1_MIXED_FIRE_DRILL_PASS_R4（task description 字面验收命令）
  动作: generator 在合规分支新增目标文档后，evaluator 执行任务描述规定的验收命令
  预期观察: test -f 与 grep -q 均 exit 0，stdout 打印 OK
  Test: manual:bash -c 'test -f docs/fire-drills/kernel-v1-mixed-20260724-r4.md && grep -q KERNEL_V1_MIXED_FIRE_DRILL_PASS_R4 docs/fire-drills/kernel-v1-mixed-20260724-r4.md || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] [L2] 文档含生产版本 1.267.67 与 merge commit 19887912bbb581597f12c714a9ed187f051e2850
  动作: evaluator 对文档内容做字面 grep 断言
  预期观察: 两个字面值均命中，stdout 打印 OK
  Test: manual:bash -c 'grep -q "1\.267\.67" docs/fire-drills/kernel-v1-mixed-20260724-r4.md && grep -q 19887912bbb581597f12c714a9ed187f051e2850 docs/fire-drills/kernel-v1-mixed-20260724-r4.md || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] [L2] 文档含各角色 provider/account 证据摘要（planner/proposer=claude·account1，reviewer/evaluator=grok·grok，generator=codex·team3）
  动作: evaluator 逐个断言六角色名与三组 provider/account 关键词在文档中出现
  预期观察: 11 个关键词全部命中，stdout 打印 OK；缺任一关键词立即 FAIL 并指名
  Test: manual:bash -c 'for kw in planner proposer reviewer generator evaluator judge claude account1 grok codex team3; do grep -qi "$kw" docs/fire-drills/kernel-v1-mixed-20260724-r4.md || { echo "FAIL: 缺 $kw"; exit 1; }; done; echo OK'
  期望: OK

- [ ] [BEHAVIOR] [L2] 旧轮次残渣反向检查——文档不含 KERNEL_V1_MIXED_FIRE_DRILL_PASS_R1/R2/R3 旧标记（r4 重跑覆盖）
  动作: evaluator 对文档做旧标记反向 grep；同时要求文件存在（防「文件不存在=无残渣」假绿）
  预期观察: 旧标记零命中且文件存在，stdout 打印 OK
  Test: manual:bash -c 'if grep -Eq "KERNEL_V1_MIXED_FIRE_DRILL_PASS_R[123]([^0-9]|$)" docs/fire-drills/kernel-v1-mixed-20260724-r4.md 2>/dev/null; then echo FAIL; exit 1; fi; test -f docs/fire-drills/kernel-v1-mixed-20260724-r4.md || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] [L2] 分支纪律——PR diff 相对 origin/main 恰好一行且为目标文档（严禁 sprints/**、.harness/**、合同产物进 PR）
  动作: 在 generator 分支工作区执行 git diff --name-only origin/main...HEAD 机械确认
  预期观察: diff 文件列表整体等于目标路径（恰一行），stdout 打印 OK；多一个文件即 FAIL 并打印实际列表
  Test: manual:bash -c 'git fetch origin main --quiet; git rev-parse --verify "origin/main^{commit}" >/dev/null || exit 1; D=$(git diff --name-only origin/main...HEAD); [ "$D" = "docs/fire-drills/kernel-v1-mixed-20260724-r4.md" ] || { echo "FAIL: diff=$D"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] [L2] merge 前置守卫——evaluate 时本分支已含文档而 origin/main 尚未含（human review 前禁止 merge 的机械代理，防提前合并/历史冒充）
  动作: evaluator 在验收时刻对 origin/main 实际状态对账
  预期观察: 本分支文档存在、origin/main 中不存在，stdout 打印 OK；origin/main 已含则判提前合并违规 FAIL
  Test: manual:bash -c 'test -f docs/fire-drills/kernel-v1-mixed-20260724-r4.md || exit 1; if git cat-file -e origin/main:docs/fire-drills/kernel-v1-mixed-20260724-r4.md 2>/dev/null; then echo "FAIL: origin/main 已含目标文档"; exit 1; fi; echo OK'
  期望: OK

## 接缝断言状态（不得标 done 的项）

- human review→merge 顺序：`logic-done-pending`——真目标验证为 merge 后 PR timeline 核对（approve 早于 merge），controller/judge 执行
- 角色真实运行证据：`logic-done-pending`——真目标验证为 independent judge 对账 Brain DB attempts/运行日志
