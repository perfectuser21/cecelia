contract_branch: cp-harness-propose-r3-92950980
workstream_index: 1
sprint_dir: sprints/cecelia-pipeline-viz-v2
journey_type: user_facing

# DoD — WS1: SKILL.md mac_web 合约模板注入截图 DoD 条目

## ARTIFACT 条目

- [x] [ARTIFACT] `packages/workflows/skills/harness-contract-proposer/SKILL.md` 含 `[BEHAVIOR:E2E:screenshot]` 文字
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-contract-proposer/SKILL.md','utf8');if(!c.includes('[BEHAVIOR:E2E:screenshot]'))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] SKILL.md 截图条目含 `~/claude-output/harness-screenshots/` 目标路径
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-contract-proposer/SKILL.md','utf8');if(!c.includes('~/claude-output/harness-screenshots/'))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] 截图条目含 `<ws_id>-<step>.png` 路径格式描述
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-contract-proposer/SKILL.md','utf8');if(!c.includes('ws_id') || !c.includes('.png'))process.exit(1);console.log('OK')"

## BEHAVIOR 条目（内嵌 manual:bash 命令）

- [x] [BEHAVIOR] SKILL.md 含 `[BEHAVIOR:E2E:screenshot]` 标签（WS1 未实现时 grep 返回 0 → exit 1 → 真红）
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-contract-proposer/SKILL.md','utf8');const count=(c.match(/\[BEHAVIOR:E2E:screenshot\]/g)||[]).length;if(count<1){console.error('FAIL: [BEHAVIOR:E2E:screenshot] 不存在，count='+count);process.exit(1);}console.log('OK: count='+count)"

- [x] [BEHAVIOR] SKILL.md 含 `harness-screenshots` 路径（WS1 未实现时 grep 无结果 → exit 1 → 真红）
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-contract-proposer/SKILL.md','utf8');if(!c.includes('harness-screenshots')){console.error('FAIL: harness-screenshots 路径未注入');process.exit(1);}console.log('OK')"

- [x] [BEHAVIOR] `[BEHAVIOR:E2E:screenshot]` 与 `mac_web` 关键词同在 SKILL.md 同一逻辑区块内（300 行内）
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-contract-proposer/SKILL.md','utf8');const mac_pos=c.indexOf('target_environment = mac_web');const ss_pos=c.indexOf('[BEHAVIOR:E2E:screenshot]');if(mac_pos===-1||ss_pos===-1){console.error('FAIL: 标记未找到');process.exit(1);}if(Math.abs(mac_pos-ss_pos)>15000){console.error('FAIL: 截图DoD距离mac_web模板过远');process.exit(1);}console.log('OK: distance='+Math.abs(mac_pos-ss_pos))"

- [x] [BEHAVIOR] SKILL.md 截图条目含 `.png` 格式说明，说明截图为 PNG 文件
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-contract-proposer/SKILL.md','utf8');if(!c.includes('.png')){console.error('FAIL: 截图格式未说明.png');process.exit(1);}console.log('OK')"
