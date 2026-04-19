# Task: Phase 1 Round 2 — 真正删除 /dev Standard 模式代码

**Task ID**: 18526648-ec62-43ab-993f-f166cbe04a14
**Branch**: cp-0419091427-phase1-round2
**Version**: Engine 14.17.7 → 14.17.8

## DoD

- [x] [BEHAVIOR] 01-spec.md 删除 Standard 主 agent 直写分支（§1.1-1.3）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/skills/dev/steps/01-spec.md','utf8');if(c.includes('## 1.1 参数检测')||c.includes('autonomous_mode = false'))process.exit(1)"

- [x] [BEHAVIOR] 02-code.md 删除 §3 standard mode
  Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/skills/dev/steps/02-code.md','utf8');if(c.includes('## 3. standard mode'))process.exit(1)"

- [x] [BEHAVIOR] SKILL.md 删除 流程（标准模式）章节
  Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/skills/dev/SKILL.md','utf8');if(c.includes('## 流程（标准模式'))process.exit(1)"

- [x] [BEHAVIOR] .dev-mode 模板不再写 autonomous_mode 字段
  Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/skills/dev/steps/01-spec.md','utf8');const devMode=c.match(/cat > \".dev-mode[\s\S]*?EOF/);if(devMode&&devMode[0].includes('autonomous_mode: true'))process.exit(1)"

- [x] [BEHAVIOR] parse-dev-args.sh 删除 Brain payload 兜底查询
  Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/skills/dev/scripts/parse-dev-args.sh','utf8');if(c.includes('payload.autonomous_mode'))process.exit(1)"

- [x] [BEHAVIOR] parse-dev-args.sh 的 --autonomous flag 降级 warn
  Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/skills/dev/scripts/parse-dev-args.sh','utf8');if(!c.includes('--autonomous flag deprecated'))process.exit(1)"

- [x] [BEHAVIOR] 00.5-enrich.md 删除 AUTONOMOUS_MODE 门禁
  Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/skills/dev/steps/00.5-enrich.md','utf8');if(c.includes('exit 0  # 非 autonomous 跳过'))process.exit(1)"

- [x] [BEHAVIOR] 00.7-decision-query.md 删除 AUTONOMOUS_MODE 门禁
  Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/skills/dev/steps/00.7-decision-query.md','utf8');const lines=c.split('\\n').slice(20,28);if(lines.some(l=>l.includes('AUTONOMOUS_MODE=')&&l.includes('grep')))process.exit(1)"

- [x] [BEHAVIOR] 04-ship.md discard 路径不再读 autonomous_mode
  Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/skills/dev/steps/04-ship.md','utf8');if(c.includes('AUTO=$(grep'))process.exit(1)"

- [x] [BEHAVIOR] 版本 6 处同步到 14.17.8
  Test: manual:node -e "const fs=require('fs');const v=fs.readFileSync('packages/engine/VERSION','utf8').trim();const pkg=JSON.parse(fs.readFileSync('packages/engine/package.json','utf8')).version;const hcv=fs.readFileSync('packages/engine/.hook-core-version','utf8').trim();const hv=fs.readFileSync('packages/engine/hooks/VERSION','utf8').trim();const skill=fs.readFileSync('packages/engine/skills/dev/SKILL.md','utf8').match(/^version:\s*(\S+)/m)[1];const reg=fs.readFileSync('packages/engine/regression-contract.yaml','utf8').match(/^version:\s*(\S+)/m)[1];if(![v,pkg,hcv,hv,skill,reg].every(x=>x==='14.17.8'))process.exit(1)"

- [x] [BEHAVIOR] L1 alignment gate 向后兼容
  Test: manual:node packages/engine/scripts/devgate/check-superpowers-alignment.cjs

- [x] [BEHAVIOR] L1 hygiene gate 向后兼容
  Test: manual:node packages/engine/scripts/devgate/check-engine-hygiene.cjs

- [x] [BEHAVIOR] L2 evidence gate 向后兼容
  Test: manual:node packages/engine/scripts/devgate/check-pipeline-evidence.cjs

- [x] [ARTIFACT] feature-registry 14.17.8 条目
  Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/feature-registry.yml','utf8');if(!c.includes('version: \"14.17.8\"'))process.exit(1)"

- [x] [ARTIFACT] Learning 文件存在
  Test: manual:bash -c "test -f docs/learnings/cp-04190914-phase1-round2.md"

- [x] [BEHAVIOR] Learning 含根本原因 + 下次预防
  Test: manual:node -e "const c=require('fs').readFileSync('docs/learnings/cp-04190914-phase1-round2.md','utf8');if(!c.includes('## 根本原因')||!c.includes('## 下次预防'))process.exit(1)"
