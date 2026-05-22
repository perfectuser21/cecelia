# Learning: scan-skills.js 只识别 name: 不识别 id: frontmatter

分支：cp-0522191456-fix-scan-skills-id-frontmatter
日期：2026-05-22

### 根本原因

`scripts/scan/scan-skills.js` 第 33 行只用正则 `/^name:\s*(.+)$/m` 匹配 frontmatter 中的 skill 名。
Superpowers 插件体系的 SKILL.md 使用 `id:` 而非 `name:` 作为标识字段（例如 `harness-planner` 的 SKILL.md），
导致这类 skill 被 scan 脚本识别为目录名（fallback），写入 system_registry 的记录与实际 skill id 不符，
引发 Brain 技能路由找不到对应条目的问题。

### 修复方案

一行修复：先匹配 `name:`，没有再匹配 `id:`：
```js
const nameMatch = content.match(/^name:\s*(.+)$/m) || content.match(/^id:\s*(.+)$/m);
```

### 下次预防

- [ ] 新增 SKILL.md 时若用 `id:` 字段，在 scan 脚本写测试覆盖
- [ ] scan 脚本支持更多 frontmatter 字段时，添加对应单测用例
- [ ] frontmatter 字段命名不统一是根因 — 后续统一 superpowers/自研 skill 的 SKILL.md schema
