---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 1: SKILL.md mac_web 截图 DoD 注入

**范围**: `packages/workflows/skills/harness-contract-proposer/SKILL.md` — mac_web 合约模板加截图 DoD 条目
**大小**: S（< 30 行）
**依赖**: 无

---

## Risks

### R1a: SKILL.md 区块格式被后续 GAN 轮改写导致截图条目丢失
**影响**: 其他 proposer 轮次修改 SKILL.md 的 mac_web 区块时，可能误删截图条目 → BEHAVIOR 4（区块内定位）FAIL。
**缓解**: BEHAVIOR 4 精确定位截图条目在 `target_environment = mac_web` 区块内；WS1 generator 追加到区块末尾，不替换整个区块。

### R1b: `[BEHAVIOR:E2E:screenshot]` 标记格式与 proposer skill 规范未来版本不兼容
**影响**: 如果 SKILL.md 里的 mac_web 合约模板区块示例标签格式变化，grep 精确匹配将 FAIL。
**缓解**: BEHAVIOR 1 grep 的字面值 `[BEHAVIOR:E2E:screenshot]` 与 v7.11.0 规范定义一致，短期内不变；若规范升级，同步更新合同。

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/workflows/skills/harness-contract-proposer/SKILL.md` 文件存在且包含 `[BEHAVIOR:E2E:screenshot]` 字样
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-contract-proposer/SKILL.md','utf8');if(!c.includes('[BEHAVIOR:E2E:screenshot]'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] SKILL.md mac_web 合约模板区块包含截图复制路径 `~/claude-output/harness-screenshots/`
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-contract-proposer/SKILL.md','utf8');if(!c.includes('~/claude-output/harness-screenshots/'))process.exit(1);console.log('OK')"

---

## BEHAVIOR 条目

- [ ] [BEHAVIOR] SKILL.md 含 `[BEHAVIOR:E2E:screenshot]` 截图条目文字（文件级可验证）
  Test: manual:bash -c 'grep -c "\[BEHAVIOR:E2E:screenshot\]" packages/workflows/skills/harness-contract-proposer/SKILL.md || exit 1; echo OK'
  期望: OK（count ≥ 1）

- [ ] [BEHAVIOR] 截图条目包含 `screenshots/<ws_id>-<step>.png` 格式占位符
  Test: manual:bash -c 'grep -E "screenshots/.*-.*\\.png" packages/workflows/skills/harness-contract-proposer/SKILL.md && echo OK || exit 1'
  期望: OK

- [ ] [BEHAVIOR] 截图条目包含复制目标路径 `~/claude-output/harness-screenshots/`
  Test: manual:bash -c 'grep "~/claude-output/harness-screenshots/" packages/workflows/skills/harness-contract-proposer/SKILL.md && echo OK || exit 1'
  期望: OK

- [ ] [BEHAVIOR] SKILL.md 注入后 mac_web 合约模板区块（`target_environment = mac_web`）能被定位，且截图条目在其下方
  Test: manual:bash -c 'awk "/target_environment = mac_web/,/target_environment = windows/" packages/workflows/skills/harness-contract-proposer/SKILL.md | grep -c "\[BEHAVIOR:E2E:screenshot\]" || exit 1; echo OK'
  期望: OK（mac_web 区块含截图条目）

---

## BEHAVIOR:E2E 条目（user_facing 专属，Mode B final-e2e 跑）

- [ ] [BEHAVIOR:E2E] evaluator 验收后截图存 screenshots/ws1-01.png，复制到 ~/claude-output/harness-screenshots/
  Screenshots:
    - ws1-01.png   期望：截图存在于目标目录，文件 > 0 bytes
  期望：find ~/claude-output/harness-screenshots/ -name "ws1-*.png" 返回 ≥ 1 条
