---
id: current-docs-readme
version: 1.0.0
created: 2026-03-10
updated: 2026-03-10
---

# docs/current/ — 当前事实文档

**铁规则：本目录只记录当前 main 分支真实存在并生效的内容。**

禁止写入：
- 计划中但未落地的架构
- MEMORY.md 里的预期状态
- 已被替换的旧结构
- 任何未经代码验证的信息

对缺失项的处理：写"未找到/未确认"，不脑补。

---

## 文档列表

| 文件 | 内容 | 上次审计 |
|------|------|---------|
| `SYSTEM_MAP.md` | 整体架构、子系统关系、数据流 | 2026-03-10 |
| `DEV_PIPELINE.md` | /dev 工作流 12 步、Hook 系统 | 2026-03-10 |
| `CI_PIPELINE.md` | 7 个 CI workflow、Brain CI / Engine CI 完整结构 | 2026-03-10 |

---

## 维护节奏

- 每累计 5~10 个 PR，或每周一次，由 Architect/Documentation Agent 重新审计代码并更新
- 发现过期内容 → 立即更新版本号，在 changelog 记录

## 对应缺口文档

`docs/gaps/ARCHITECTURE_GAPS.md` — 记录未文档化、不一致、待审计的部分
