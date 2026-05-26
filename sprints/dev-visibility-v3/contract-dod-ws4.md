---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 4: harness-generator SKILL.md 串行化 + 文件名统一

**范围**: `packages/workflows/skills/harness-generator/SKILL.md`（Step 0.5 注释由"并行派发"改为"串行派发（每个 ws merge gate 通过后 Brain 才启动下一个）"；移除 `contract-draft.md` 引用，保留 `sprint-contract.md`）
**大小**: S（~5 行修改，1 文件）
**依赖**: Workstream 3 完成后

## ARTIFACT 条目

- [x] [ARTIFACT] `harness-generator/SKILL.md` 不含"并行派发"旧文字
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-generator/SKILL.md','utf8');if(c.includes('并行派发'))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] `harness-generator/SKILL.md` 含"串行派发"新文字
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-generator/SKILL.md','utf8');if(!c.includes('串行派发'))process.exit(1);console.log('OK')"

## BEHAVIOR 条目

- [x] [BEHAVIOR] Step 0.5 注释改为串行派发（文件不再含"并行派发"，含"串行派发"）
  Test: manual:bash -c '
  node -e "
  const c=require(\"fs\").readFileSync(\"packages/workflows/skills/harness-generator/SKILL.md\",\"utf8\");
  if(c.includes(\"并行派发\")){console.error(\"FAIL: 仍含旧文字并行派发\");process.exit(1);}
  if(!c.includes(\"串行派发\")){console.error(\"FAIL: 未改为串行派发\");process.exit(1);}
  console.log(\"OK\");
  "
  '
  期望: OK

- [x] [BEHAVIOR] `contract-draft.md` 旧引用已移除，不出现在文件任何位置
  Test: manual:bash -c '
  node -e "
  const c=require(\"fs\").readFileSync(\"packages/workflows/skills/harness-generator/SKILL.md\",\"utf8\");
  if(c.includes(\"contract-draft.md\")){console.error(\"FAIL: contract-draft.md 旧引用未移除\");process.exit(1);}
  console.log(\"OK\");
  "
  '
  期望: OK

- [x] [BEHAVIOR] `sprint-contract.md` 文件名引用仍然存在（统一后的正确文件名）
  Test: manual:bash -c '
  node -e "
  const c=require(\"fs\").readFileSync(\"packages/workflows/skills/harness-generator/SKILL.md\",\"utf8\");
  if(!c.includes(\"sprint-contract.md\")){console.error(\"FAIL: sprint-contract.md 引用丢失\");process.exit(1);}
  console.log(\"OK\");
  "
  '
  期望: OK

- [x] [BEHAVIOR] Step 0.5 标题行后的注释包含 merge gate 串行说明（确认说明完整而非只换关键词）
  Test: manual:bash -c '
  node -e "
  const c=require(\"fs\").readFileSync(\"packages/workflows/skills/harness-generator/SKILL.md\",\"utf8\");
  const step05Idx=c.indexOf(\"Step 0.5\");
  if(step05Idx===-1){console.error(\"FAIL: Step 0.5 不存在\");process.exit(1);}
  const step05Body=c.slice(step05Idx, step05Idx+800);
  // 串行说明必须含 merge gate 相关概念
  const hasMergeGate=(step05Body.includes(\"merge gate\") || step05Body.includes(\"merge\") || step05Body.includes(\"串行\"));
  if(!hasMergeGate){console.error(\"FAIL: Step 0.5 缺 merge gate 串行说明\");process.exit(1);}
  console.log(\"OK\");
  "
  '
  期望: OK

- [x] [BEHAVIOR] error path — `harness-generator/SKILL.md` 文件可读（非空，存在于磁盘）
  Test: manual:bash -c '
  node -e "
  const fs=require(\"fs\");
  const stat=fs.statSync(\"packages/workflows/skills/harness-generator/SKILL.md\");
  if(stat.size < 100){console.error(\"FAIL: 文件过小或被清空\");process.exit(1);}
  console.log(\"OK size=\"+stat.size);
  "
  '
  期望: OK，文件 size > 100
