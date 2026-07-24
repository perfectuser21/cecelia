---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Kernel v1 mixed provider fire drill 终试（r3）

**范围**: 仅新增 docs/fire-drills/kernel-v1-mixed-20260724-r3.md 一个文件（含标记/版本/merge commit/六角色运行证据摘要）；不触碰 packages/brain、现有合同测试、migrations、产品逻辑、CI workflow
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 交付文件存在且含 fire drill 标记
  Test: node -e "const c=require('fs').readFileSync('docs/fire-drills/kernel-v1-mixed-20260724-r3.md','utf8');if(!c.includes('KERNEL_V1_MIXED_FIRE_DRILL_PASS_R3'))process.exit(1)"

- [ ] [ARTIFACT] 红测试文件存在（TDD Red 载体）
  Test: node -e "const c=require('fs').readFileSync('sprints/0724181049-kernel-fire-drill-mixed-r3/tests/fire-drill-doc.test.ts','utf8');if(!c.includes('KERNEL_V1_MIXED_FIRE_DRILL_PASS_R3'))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，evaluator 直接跑）

- [ ] [BEHAVIOR] [L2] PRD 验收命令原样通过：文件存在且含标记 KERNEL_V1_MIXED_FIRE_DRILL_PASS_R3
  动作: kernel-v1 接力链 generator 在分支上新增交付文件后，evaluator 在 repo 根目录执行 PRD 指定的两条验收命令
  预期观察: test -f 与 grep -q 均 exit 0，stdout 出现 OK
  Test: manual:bash -c 'test -f docs/fire-drills/kernel-v1-mixed-20260724-r3.md && grep -q KERNEL_V1_MIXED_FIRE_DRILL_PASS_R3 docs/fire-drills/kernel-v1-mixed-20260724-r3.md && echo OK'
  期望: OK

- [ ] [BEHAVIOR] [L2] 文件字面包含生产版本 1.267.67 与 merge commit 19887912bbb581597f12c714a9ed187f051e2850
  动作: 读取交付文件全文
  预期观察: 两个字面串各命中 ≥1 处，缺一即非零退出
  Test: manual:node -e "const c=require('fs').readFileSync('docs/fire-drills/kernel-v1-mixed-20260724-r3.md','utf8');if(!c.includes('1.267.67')||!c.includes('19887912bbb581597f12c714a9ed187f051e2850'))process.exit(1);console.log('OK')"
  期望: OK

- [ ] [BEHAVIOR] [L2] 六角色 provider/account 证据行齐全（planner/proposer=claude/account1，reviewer/evaluator=grok/grok，generator=codex/team3，judge 值以实际 run 为准）
  动作: 读取交付文件证据段
  预期观察: 5 组 PRD 字面 pair + judge= 前缀行全部命中，缺任一角色即非零退出并列出缺失项
  Test: manual:node -e "const c=require('fs').readFileSync('docs/fire-drills/kernel-v1-mixed-20260724-r3.md','utf8');const need=['planner=claude/account1','proposer=claude/account1','reviewer=grok/grok','evaluator=grok/grok','generator=codex/team3','judge='];const miss=need.filter(function(s){return !c.includes(s)});if(miss.length){console.error('FAIL missing:'+miss.join(','));process.exit(1)}console.log('OK')"
  期望: OK

- [ ] [BEHAVIOR] [L2] 证据锚定本次 run_id 4c7fcc5b-32ee-4a7f-9649-3b857ed30610（防伪：历史 r1/r2 文件不可能包含本轮 run_id，等价 DB 时间窗）
  动作: 读取交付文件证据段
  预期观察: run_id 字面命中 ≥1 处
  Test: manual:bash -c 'test -f docs/fire-drills/kernel-v1-mixed-20260724-r3.md && grep -qF 4c7fcc5b-32ee-4a7f-9649-3b857ed30610 docs/fire-drills/kernel-v1-mixed-20260724-r3.md && echo OK'
  期望: OK

- [ ] [BEHAVIOR] [L2] diff 范围守卫：相对 origin/main 仅允许 docs/fire-drills/ 与本 sprint harness 产物，packages/brain、migrations、现有测试、.github/ 越界即 FAIL
  动作: evaluator 在 generator 分支上比对 origin/main
  预期观察: 允许清单外 diff 文件数为 0，越界时列出违规文件并非零退出
  Test: manual:bash -c 'test -f docs/fire-drills/kernel-v1-mixed-20260724-r3.md || { echo "FAIL: 交付文件不存在"; exit 1; }; git fetch origin main --quiet; V=$(git diff --name-only origin/main...HEAD | grep -vE "^(docs/fire-drills/|sprints/0724181049-kernel-fire-drill-mixed-r3/)" || true); [ -z "$V" ] || { echo "FAIL diff 越界: $V"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] [L2] merge 门禁：authenticated human review 批准前，origin/main 不得已含交付文件（禁止 generator 自行 merge / CI 兜底提前合并）
  动作: evaluator 在 merge 前时点 fetch origin main 并检查对象存在性
  预期观察: git cat-file -e 非零（文件未上 main），已上 main 即 FAIL
  Test: manual:bash -c 'test -f docs/fire-drills/kernel-v1-mixed-20260724-r3.md || { echo "FAIL: 交付文件不存在"; exit 1; }; git fetch origin main --quiet; if git cat-file -e origin/main:docs/fire-drills/kernel-v1-mixed-20260724-r3.md 2>/dev/null; then echo "FAIL: human review 前已 merge"; exit 1; fi; echo OK'
  期望: OK

- [ ] [BEHAVIOR] [L2] 凭据脱敏守卫：交付文档不得含凭据明文特征串（证据摘要只许 provider/account 别名）
  动作: 对交付文件全文做凭据特征扫描
  预期观察: sk-ant- / xai-<token> / AKIA<16位> / OP_SERVICE_ACCOUNT_TOKEN= 命中数为 0
  Test: manual:bash -c 'test -f docs/fire-drills/kernel-v1-mixed-20260724-r3.md || { echo "FAIL: 交付文件不存在"; exit 1; }; grep -qE "(sk-ant-|xai-[A-Za-z0-9]{8}|AKIA[0-9A-Z]{16}|OP_SERVICE_ACCOUNT_TOKEN=)" docs/fire-drills/kernel-v1-mixed-20260724-r3.md && { echo "FAIL: 疑似凭据明文"; exit 1; } || true; echo OK'
  期望: OK
