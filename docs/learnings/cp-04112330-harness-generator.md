### 根本原因

harness-planner SKILL.md v4.1 → v5.0 升级：增强 Step 0（Brain API 上下文采集 + 边界声明 + 移除旧式 ls/cat）、新增 9 类歧义自检（Step 1）、重写 PRD 模板（User Stories/GWT/FR-SC/OKR 对齐/假设/边界/范围限定）。

合同历经 6 轮 GAN 对抗，关键问题：正则兼容性（`[^]` → `[\s\S]`）、匹配范围限定（防 changelog 绕过）、动态章节边界（OKR 区域不再硬编码 1000 字符）。

### 下次预防

- [ ] 正则用 `[\s\S]` 而非 `[^]`，后者是 V8 非标准扩展
- [ ] 范围限定检查：先提取目标区域（Step 0 → Step 1），再做 includes 验证，防止 changelog/附录绕过
- [ ] 动态章节边界：用 `search(/^## /m)` 找下一个二级标题，而非硬编码固定字符数
