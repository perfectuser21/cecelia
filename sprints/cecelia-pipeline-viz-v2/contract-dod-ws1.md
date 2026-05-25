---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 1: SKILL.md mac_web 合约模板注入截图 DoD 条目

**范围**: `packages/workflows/skills/harness-contract-proposer/SKILL.md` — 在 mac_web 合约模板（`target_environment = mac_web` 区块）末尾添加 `[BEHAVIOR:E2E:screenshot]` 截图 DoD 条目，说明 evaluator 验收后截图存入 `~/claude-output/harness-screenshots/<ws_id>-<step>.png`
**大小**: S（约 30 行注入，1 文件）
**依赖**: 无

---

## Risks

### R1a: 注入位置错误（插入非 mac_web 区块）
**影响**: 截图规格对其他 target_environment 产生误导，future proposer 在 local_api sprint 里也添加截图 DoD
**缓解**: ARTIFACT 条目精确 grep 位置上下文，`[BEHAVIOR:E2E:screenshot]` 必须与 `target_environment = mac_web` 同在一个 section

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/workflows/skills/harness-contract-proposer/SKILL.md` 含 `[BEHAVIOR:E2E:screenshot]` 文字
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-contract-proposer/SKILL.md','utf8');if(!c.includes('[BEHAVIOR:E2E:screenshot]'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] SKILL.md 截图条目含 `~/claude-output/harness-screenshots/` 目标路径
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-contract-proposer/SKILL.md','utf8');if(!c.includes('~/claude-output/harness-screenshots/'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] 截图条目含 `<ws_id>-<step>.png` 路径格式描述
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-contract-proposer/SKILL.md','utf8');if(!c.includes('ws_id') || !c.includes('.png'))process.exit(1);console.log('OK')"

---

## BEHAVIOR 条目（内嵌 manual:bash 命令）

- [ ] [BEHAVIOR] SKILL.md 含 `[BEHAVIOR:E2E:screenshot]` 标签（WS1 未实现时 grep 返回 0 → exit 1 → 真红）
  Test: manual:bash -c 'COUNT=$(grep -c "\[BEHAVIOR:E2E:screenshot\]" packages/workflows/skills/harness-contract-proposer/SKILL.md 2>/dev/null || echo 0); [ "$COUNT" -ge 1 ] || { echo "FAIL: [BEHAVIOR:E2E:screenshot] 不存在，count=$COUNT"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] SKILL.md 含 `harness-screenshots` 路径（WS1 未实现时 grep 无结果 → exit 1 → 真红）
  Test: manual:bash -c 'grep -q "harness-screenshots" packages/workflows/skills/harness-contract-proposer/SKILL.md || { echo "FAIL: harness-screenshots 路径未注入"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] `[BEHAVIOR:E2E:screenshot]` 与 `mac_web` 关键词同在 SKILL.md 同一逻辑区块内（300 行内）
  Test: manual:bash -c 'python3 -c "
import re
c = open(\"packages/workflows/skills/harness-contract-proposer/SKILL.md\").read()
mac_pos = c.find(\"target_environment = mac_web\")
ss_pos = c.find(\"[BEHAVIOR:E2E:screenshot]\")
if mac_pos == -1 or ss_pos == -1:
    print(\"FAIL: 标记未找到\"); exit(1)
if abs(mac_pos - ss_pos) > 15000:
    print(f\"FAIL: 截图 DoD 距离 mac_web 模板过远 ({abs(mac_pos-ss_pos)} chars)\"); exit(1)
print(\"OK\")
"'
  期望: OK

- [ ] [BEHAVIOR] SKILL.md 截图条目含 `.png` 格式说明，说明截图为 PNG 文件
  Test: manual:bash -c 'grep -q "\.png" packages/workflows/skills/harness-contract-proposer/SKILL.md || { echo "FAIL: 截图格式未说明 .png"; exit 1; }; echo OK'
  期望: OK
