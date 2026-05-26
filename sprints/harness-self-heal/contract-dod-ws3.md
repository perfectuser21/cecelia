---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 3: Intervention Skill SKILL.md

**范围**: 新建 `packages/engine/skills/harness-intervention/SKILL.md`（日志读取 + checkpoint + 卡死类型识别 + 修复操作 + 30s 验证 + Bark 降级告警）
**大小**: M（~120 行净增，1 文件）
**依赖**: Workstream 2

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/engine/skills/harness-intervention/SKILL.md` 存在
  Test: node -e "require('fs').accessSync('packages/engine/skills/harness-intervention/SKILL.md');console.log('OK')"

- [ ] [ARTIFACT] SKILL.md 包含容器日志读取（docker logs --tail 200）
  Test: node -e "const s=require('fs').readFileSync('packages/engine/skills/harness-intervention/SKILL.md','utf8');if(!s.includes('docker logs'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] SKILL.md 包含三类卡死类型描述（CI 未触发 / PR 未推 / Brain 状态）
  Test: node -e "const s=require('fs').readFileSync('packages/engine/skills/harness-intervention/SKILL.md','utf8');['CI 未触发','PR 未推','Brain 状态'].forEach(k=>{if(!s.includes(k)){console.error('FAIL: 缺',k);process.exit(1);}});console.log('OK')"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] SKILL.md 包含 BARK_TOKEN 告警集成描述
  Test: manual:bash -c 'node -e "const s=require(\"fs\").readFileSync(\"packages/engine/skills/harness-intervention/SKILL.md\",\"utf8\");if(!s.includes(\"BARK_TOKEN\")){console.error(\"FAIL: 缺 BARK_TOKEN\");process.exit(1);}console.log(\"OK\")"'
  期望: OK（exit 0）

- [ ] [BEHAVIOR] SKILL.md 包含 checkpoint 读取步骤（Brain checkpoint 数据源）
  Test: manual:bash -c 'node -e "const s=require(\"fs\").readFileSync(\"packages/engine/skills/harness-intervention/SKILL.md\",\"utf8\");if(!s.includes(\"checkpoint\")){console.error(\"FAIL: 缺 checkpoint 读取\");process.exit(1);}console.log(\"OK\")"'
  期望: OK（exit 0）

- [ ] [BEHAVIOR] SKILL.md 包含 30s 等待验证步骤
  Test: manual:bash -c 'node -e "const s=require(\"fs\").readFileSync(\"packages/engine/skills/harness-intervention/SKILL.md\",\"utf8\");if(!s.match(/30s|30 秒|30 second/i)){console.error(\"FAIL: 缺 30s 等待\");process.exit(1);}console.log(\"OK\")"'
  期望: OK（exit 0）

- [ ] [BEHAVIOR] SKILL.md 包含 Brain API 不可达降级策略描述
  Test: manual:bash -c 'node -e "const s=require(\"fs\").readFileSync(\"packages/engine/skills/harness-intervention/SKILL.md\",\"utf8\");if(!s.match(/不可达|unavailable|5221/i)){console.error(\"FAIL: 缺 Brain API 降级描述\");process.exit(1);}console.log(\"OK\")"'
  期望: OK（exit 0）

- [ ] [BEHAVIOR] SKILL.md 包含 sprint 合同文件读取步骤
  Test: manual:bash -c 'node -e "const s=require(\"fs\").readFileSync(\"packages/engine/skills/harness-intervention/SKILL.md\",\"utf8\");if(!s.includes(\"contract\")){console.error(\"FAIL: 缺 contract 读取\");process.exit(1);}console.log(\"OK\")"'
  期望: OK（exit 0）
