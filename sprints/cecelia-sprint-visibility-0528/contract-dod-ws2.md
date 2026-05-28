---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 2: harness-report SKILL.md Step 3.5 修正

**范围**: 修正 packages/workflows/skills/harness-report/SKILL.md 中 Step 3.5 的问题：(1) type 字段改用 DOC_TYPE 变量而非硬编码 "Log"；(2) sprint-prd.md 的 type 从 "PRD" 改为 "SprintPRD"；(3) 请求体字段从 "body" 改为 "content"；(4) 增加 initiative_id 和 sprint_dir 字段
**大小**: S（~20 行改动，1 文件）
**依赖**: Workstream 1

## ARTIFACT 条目

- [x] [ARTIFACT] harness-report SKILL.md 含 "Step 3.5" 字面量
  Test: bash -c 'grep -q "Step 3.5" packages/workflows/skills/harness-report/SKILL.md || exit 1'

- [x] [ARTIFACT] SKILL.md Step 3.5 映射中含 "SprintPRD"（不是 "PRD"）
  Test: bash -c 'grep -A30 "Step 3.5" packages/workflows/skills/harness-report/SKILL.md | grep -q "SprintPRD" || exit 1'

- [x] [ARTIFACT] SKILL.md Step 3.5 映射中含 "PrepPRD"
  Test: bash -c 'grep -A30 "Step 3.5" packages/workflows/skills/harness-report/SKILL.md | grep -q "PrepPRD" || exit 1'

- [x] [ARTIFACT] SKILL.md Step 3.5 使用 "content" 字段（不是 "body"）发送 POST
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-report/SKILL.md','utf8');const s=c.split('Step 3.5')[1]?.split('Step 4')[0]||'';if(s.includes('\"body\"'))process.exit(1);if(!s.includes('\"content\"'))process.exit(1);console.log('OK')" || exit 1

## BEHAVIOR 条目（内嵌可执行 manual: 命令）

- [x] [BEHAVIOR] SKILL.md Step 3.5 中 sprint-prd.md 映射类型为 "SprintPRD" 而非 "PRD"
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"packages/workflows/skills/harness-report/SKILL.md\",\"utf8\");const s35=c.split(\"Step 3.5\")[1]?.split(\"Step 4\")[0]||\"\";if(s35.includes(\"sprint-prd.md:PRD\")){console.error(\"FAIL: 仍用旧值 :PRD\");process.exit(1)}if(!s35.includes(\"SprintPRD\")){console.error(\"FAIL: SprintPRD 缺失\");process.exit(1)}console.log(\"OK\")"'
  期望: OK；Step 3.5 区间内不含 "sprint-prd.md:PRD"，必含 SprintPRD

- [x] [BEHAVIOR] SKILL.md Step 3.5 POST 请求体使用 content 字段（不是 body）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"packages/workflows/skills/harness-report/SKILL.md\",\"utf8\");const s35=c.split(\"Step 3.5\")[1]?.split(\"Step 4\")[0]||\"\";if(s35.includes(\"\\\"body\\\"\")){console.error(\"FAIL: 仍含 body 字段\");process.exit(1)}if(!s35.includes(\"\\\"content\\\"\")){console.error(\"FAIL: content 字段缺失\");process.exit(1)}console.log(\"OK\")"'
  期望: OK；Step 3.5 区间内无 "body" 字段，必含 "content" 字段

- [x] [BEHAVIOR] SKILL.md Step 3.5 type 使用 DOC_TYPE 变量（不是硬编码 "Log"）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"packages/workflows/skills/harness-report/SKILL.md\",\"utf8\");const s35=c.split(\"Step 3.5\")[1]?.split(\"Step 4\")[0]||\"\";const bad=/\"type\":\s*\"Log\"/.test(s35);const good=/DOC_TYPE|\\$DOC_TYPE/.test(s35);if(bad){console.error(\"FAIL: type 硬编码 Log\");process.exit(1)}if(!good){console.error(\"FAIL: 未使用 DOC_TYPE 变量\");process.exit(1)}console.log(\"OK\")"'
  期望: OK；Step 3.5 区间内 type 使用 $DOC_TYPE 变量，不含 "Log" 字面量

- [x] [BEHAVIOR] SKILL.md Step 3.5 POST payload 含 initiative_id 字段
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"packages/workflows/skills/harness-report/SKILL.md\",\"utf8\");const s35=c.split(\"Step 3.5\")[1]?.split(\"Step 4\")[0]||\"\";if(!s35.includes(\"initiative_id\")){console.error(\"FAIL: initiative_id 字段缺失\");process.exit(1)}console.log(\"OK\")"'
  期望: OK；Step 3.5 含 initiative_id 字段

- [x] [BEHAVIOR] SKILL.md Step 3.5 三种类型覆盖（PrepPRD/SprintPRD/Contract）在 Step 3 之后 Step 4 之前
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"packages/workflows/skills/harness-report/SKILL.md\",\"utf8\");const s35=c.split(\"Step 3.5\")[1]?.split(\"Step 4\")[0]||\"\";if(!s35.includes(\"PrepPRD\")){console.error(\"FAIL: PrepPRD 缺失\");process.exit(1)}if(!s35.includes(\"SprintPRD\")){console.error(\"FAIL: SprintPRD 缺失\");process.exit(1)}if(!s35.includes(\"Contract\")){console.error(\"FAIL: Contract 类型缺失\");process.exit(1)}console.log(\"OK\")"'
  期望: OK；Step 3.5 覆盖三种类型字面量
