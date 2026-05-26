## fix(scan): scan-skills.js id: frontmatter fallback（2026-05-22）

### 根本原因
`scan-skills.js` 的 `name:` 正则只匹配 `name:` frontmatter，harness pipeline 6 个 skill 的 SKILL.md 使用 `id:` 字段，导致每次 PR 合并后扫描结果漏掉这 6 个核心 skill，system_registry 中只有目录名或缺失条目。

### 下次预防
- [ ] 新建 skill 时统一用 `name:` frontmatter（现有约定）
- [ ] scan-skills.js 支持 `id:` fallback，兼容历史遗留格式
- [ ] 扫描完成后验证 harness-* skill 数量 ≥ 6，否则报警
