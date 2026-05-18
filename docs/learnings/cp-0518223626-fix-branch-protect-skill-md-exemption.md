## SKILL.md 豁免分支保護 + Harness Pipeline 假陽性修復（2026-05-18）

### 根本原因

1. **branch-protect.sh 誤傷 `.md` 文件**：`/skills/` 路徑規則未區分文件類型，SKILL 文檔被分支保護拦截，但 CLAUDE.md 明確 Skill 文件是豁免項
2. **harness-evaluator rule 4 容忍弱 oracle**：`curl -f` 無 `jq -e` 值校驗的命令仍給 PASS，evaluator 假陽性的直接原因
3. **harness-contract-proposer 禁止事項 #3 遺留矛盾**：v5.0 舊規則「禁 [BEHAVIOR] 出現在 DoD 文件」殘留，與 v7.4+ 要求正面矛盾，導致 LLM 行為不一致
4. **check-dod-purity.cjs Rule 1 協議撕裂**：CI 拦截 `[BEHAVIOR]`，與 v7.4+ 協議完全矛盾，proposer 按新協議寫的 DoD 會被 CI 打回

### 下次預防

- [ ] 修改 hook 時，明確區分「代碼文件保護」vs「文檔文件保護」，不能用路徑規則無差別攔截
- [ ] SKILL changelog 廢止舊規則時，必須同時刪除「禁止事項」中對應的舊規則條目，避免正文與禁止事項自相矛盾
- [ ] CI 腳本（.cjs/.sh）與 SKILL 協議版本必須同步更新，協議升版時同步更新 CI 腳本是強制項
- [ ] evaluator 反作弊規則只有「FAIL」和「PASS」兩種，不能有「容忍但報告」的中間態——中間態在 GAN 已收斂後無意義
