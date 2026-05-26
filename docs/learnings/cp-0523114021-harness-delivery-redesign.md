## harness 交付层改造：GAN标注 + DoD E2E截图 + 6步报告（2026-05-23）

### 根本原因

harness pipeline 的合同/验证/交付三个 SKILL 各有信息盲区：
1. **GAN对抗标注缺失**：proposer/reviewer 加的合同点用户无法区分是自己说的还是 AI 加的，Notion 报告无法体现来源透明性
2. **DoD 只有 API 层**：`[BEHAVIOR]` 只有 curl API 验证，缺 Playwright E2E 层，截图无规格
3. **harness-report 只写本地文件**：Brain 任务状态未回写，飞书/Notion 未通知，用户不知道交付结果

### 下次预防

- [ ] 每个 Golden Path Step 必须声明 `**来源**: [FROM_PRD]` 或 `[AI_ADDED]` + 理由
- [ ] user_facing 的 DoD 必须含 `## BEHAVIOR:E2E` 段（截图规格 + Claude 视觉自验期望）
- [ ] mac_web Playwright 脚本必须在关键操作前后加 `page.screenshot()`
- [ ] harness-evaluator Mode B mac_web 跑完后必须执行 Step B-2.5（截图复制 + 视觉自验 + URL写入）
- [ ] harness-report 必须走全 6 步（Brain回写 + Dashboard + Notion + FeatureRegistry + 飞书 + 本地报告）
