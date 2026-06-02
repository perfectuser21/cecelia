# Learning: B56 — loadSkillContent 缓存失败结果 + 静默降级

### 根本原因
`loadSkillContent` 找不到 SKILL.md 时返回空串 + 缓存空串（`_skillCache.set(name,'')`），调用方（buildGeneratorPrompt 等）拿空串照样拼 prompt 静默降级。fresh run b6e10d97 实证：generator 拿到空 SKILL prompt（无 commit/push/PR 指令）→ 写完代码就"完成"，从没开 PR → Final E2E FAIL，成果随 --rm 容器蒸发。"回退到空 SKILL"不是有效降级——SKILL 缺失 = 系统配置坏了，没有合理的"无 SKILL 正常工作"语义。

### 下次预防
- [ ] 关键资源（SKILL/合同/凭据）加载失败必须 fail-fast 抛错，禁止返回空值让调用方静默降级
- [ ] 缓存禁止缓存失败结果（空/null/error），否则一次偶发失败永久化；只缓存成功
- [ ] silent failure 是最难 debug 的——宁可 loud failure（task failed + 明确 error）也不要"假成功"
- [ ] LLM agent 的 prompt 拼装：SKILL/指令缺失时，agent 会"照残缺 prompt 尽力做"产出似是而非的结果，比直接报错更难发现
