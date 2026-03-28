# Skills 能力索引

> 自动生成，勿手动编辑。源文件：`packages/workflows/skills/*/SKILL.md`
> 更新方式：新增 Skill 后运行 `node scripts/generate-skills-index.mjs`

**共 71 个 Skills** | 按类型分组

---

## 决策与规划

| Skill | 触发 | 职责 |
|-------|------|------|
| `/plan` | 用户描述任何想做的事 | 意图识别 + 层级路由（OKR/Project/Initiative/Task） |
| `/decomp` | 拆解 OKR/Project/Initiative | 全链路 Project Management 拆解引擎 |
| `/decomp-check` | 审查拆解质量 | 拆解质检，Vivian 角色，三态裁决（approved/needs_revision/rejected） |
| `/strategy-session` | 战略会议 | C-Suite 级战略推演，Opus 模型 |
| `/explore` | 现状盘点 | 只看不改，如实报告当前是什么情况 |

---

## 开发工程

| Skill | 触发 | 职责 |
|-------|------|------|
| `/dev` | 任何代码变更 | **统一开发工作流**：Worktree → PRD → 代码 → PR → CI → 合并 |
| `/review` | 代码审查 | 审查模式（找问题不改）+ 初始化模式（qa_init） |
| `/audit` | 代码审计 | 分层审计：L1阻塞/L2功能/L3最佳实践/L4优化 |
| `/qa` | QA 总控 | 跨仓库测试决策、回归契约、Golden Paths |
| `/arch-review` | 架构审查 | verify（Initiative 完成验收）+ review（日常巡检） |
| `/architect` | 架构设计 | 新架构设计，Opus 模型 |
| `/assurance` | 质量门禁 | 检查系统与业务系统的唯一协调者（RADNA 体系） |
| `/code-review` | 代码变更扫描 | 扫描最近提交，发现 bug/安全/竞态 |
| `/brain-register` | 向 Brain 注册新实体 | 新 Agent/task_type/Skill 的多文件联动注册 |
| `/repo-lead` | 部门主管角色 | 跨 PR 协调，部门级代码决策 |

---

## 知识与记忆

| Skill | 触发 | 职责 |
|-------|------|------|
| `/librarian` | 生成知识页、补充说明书 | 从源码生成 HTML 知识页，每次 3-5 个，批量生成 86 页 |
| `/knowledge` | 记下来、存进知识库 | 知识捕获，结构化存入知识库 |
| `/research` | 深度调研 | 后台运行，WebSearch + 结构化报告 |
| `/notebooklm` | 创建 Notebook、生成播客 | Google NotebookLM 完整 API 操控 |

---

## 内容发布（社交媒体）

| Skill | 平台 | 方案 |
|-------|------|------|
| `/douyin-publisher` | 抖音 | 图文/视频/文章，零 AI 干预 |
| `/kuaishou-publisher` | 快手 | 图文，CDP Cookie + HTTP |
| `/toutiao-publisher` | 今日头条 | 微头条/文章/视频，NAS 统一调度 |
| `/weibo-publisher` | 微博 | 图文，Playwright CDP |
| `/wechat-publisher` | 微信公众号 | 图文，官方 API |
| `/xiaohongshu-publisher` | 小红书 | 图文，N8N → SSH → Mac mini → CDP |
| `/zhihu-publisher` | 知乎 | 文章，Mac mini CDP |
| `/content-creator` | 多平台 | 内容制作中心入口目录 |
| `/share-card` | 通用 | 9:16 竖版卡片，PNG 直出 |
| `/quote-card-generator` | 通用 | ChatGPT 生成金句卡片 |

---

## 系统工具

| Skill | 触发 | 职责 |
|-------|------|------|
| `/credentials` | API Token/Secret/Key | 凭据管理，~/.credentials/ 目录 |
| `/janitor` | 系统清扫 | 磁盘清理（daily 4am）+ 僵尸进程（每30分钟） |
| `/nas` | NAS 操作 | NAS 内容管理 |
| `/sync-hk` | 同步到香港 | 美国 VPS → 香港 VPS，Tailscale + rsync |
| `/chrome` | 看页面、截图 | agent-browser（省 context）+ chrome-devtools MCP（深度调试） |
| `/versioning` | 文件版本管理 | 自动添加/更新 frontmatter 版本号 |
| `/cecelia-brain` | 大脑直接对话 | 三层架构直接调用（脑干/丘脑/皮层） |
| `/skill-creator` | 创建/优化 Skill | 新建 Skill、迭代改进、eval 评测 |
| `/platform-scraper` | 平台数据采集 | 管理所有媒体平台的采集配置 |
| `/social-media-analysis` | 社媒数据分析 | TimescaleDB 查询和分析 |
| `/trading-agent` | 自动交易 | 24/7 交易代理，Cecelia 调度监控 |

---

## 可视化

| Skill | 触发 | 职责 |
|-------|------|------|
| `/repo-visualizer` | 仓库架构图 | 生成交互式仓库架构可视化 |
| `/canvas-project` | 功能架构图 | Feature → Module → Logic → Code 四层图 |
| `/feature-map` | 功能地图 | 系统关键功能交互式地图 |
| `/frontend-design` | 前端设计 | 生产级前端界面，配合 chrome-devtools |

---

## 新增 Skills（待分类）

| Skill | 触发 | 职责 |
|-------|------|------|
| `/autumnrice` | — | 秋米 - PM 拆解专家（角色定义）。 |
| `/batch-luxury-card-generator` | — | 批量处理 Notion 数据库中的页面，为每个页面生成高级玻璃效果卡片（2K 9:16），自动上传到 Notion 页面底部和飞书 |
| `/batch-notion-analyzer` | — | 批量处理 Notion 数据库中"未使用"页面 → 双层并行分析 → 自动清理过期文档。这是默认的日常工作流，分析完成后自动清理工作区。 |
| `/cecelia` | — | 塞西莉亚 - Cecelia 的嘴巴（对外接口）。 |
| `/claude-work-summarizer` | — | 总结 Claude Code 会话中的工作内容并保存到 Notion，帮助记录开发历史和决策过程 |
| `/content-analyzer` | — | /content-analyzer skill |
| `/content-rewriter` | — | /content-rewriter skill |
| `/dashboard-debug` | — | Dashboard 前端部署常见错误案例库 - 记录每次失败的原因和修复方法 |
| `/headless-deploy` | — | 将项目 Skill 软链接部署到无头工作区 |
| `/image-gen-workflow` | — | Image Generation Workflow |
| `/luxury-card-generator` | — | 根据内容数据生成高级玻璃效果卡片图片（2K 9:16），支持 hook、paradox、insight、transformation、steps 等多种卡片类型 |
| `/media-scraping` | — | Media Scraping Skill |
| `/nas-backup` | — | /nas-backup skill |
| `/nobel` | — | 诺贝 - N8N 管理 Agent。 |
| `/session-1-summarize` | — | 总结 Claude Code 会话（1 个功能）。自动提取执行摘要（阶段、做了什么、踩的坑、下一步）并保存到 Project Notes |
| `/talk` | — | /talk skill |
| `/test-personal-skill` | — | 查看 NAS 统计信息 |
| `/two-layer-parallel-analyzer` | — | 对 Notion 页面内容执行双层并行分析，Layer 1 包含话题总结、受众价值分析、IP感知影响、权威增强，Layer 2 生成 5 个 Dan Koe 风格推荐方向 |
| `/upgrade-dashboard` | — | /upgrade-dashboard skill |

---

## 新增 Skills（待分类）

| Skill | 触发 | 职责 |
|-------|------|------|
| `/code-review-gate` | — | 代码审查 Gate（/dev Stage 2 最后一步）。合并了 code_quality（代码质量审查）和 /simplify（代码简化）。 |
| `/codex-test-gen` | — | Codex 自动测试生成。扫描覆盖率低的模块，自动生成单元测试。 |
| `/creator` | — | 内容制作中心 — 所有卡片、图文、视觉内容生成工具的入口目录。触发词：做内容、做图、做卡片、内容制作、content creator、有哪些卡片工具、我要做一套内容、制作素材 |
| `/initiative-review` | — | Initiative 验收 Gate（Codex Gate 4/4）。合并了 initiative_verify（功能验收）和 cto_review 的整体审查部分。 |
| `/longform-creator` | — | /longform-creator skill |
| `/playwright` | — | /playwright — Playwright 自动化探索 Skill |
| `/prd-review` | — | PRD 审查 Gate（Codex Gate 1/4）。合并了 decomp-check（拆解质检）和 prd_audit（PRD 审计）。 |
| `/spec-review` | — | Spec 审查 Gate（Codex Gate 2/4）。合并了 dod_verify（DoD 验证）和 cto_review 的单 PR 审查部分。 |

---

## 任务类型 → Skill 路由

Brain 根据 `task_type` 自动路由到对应 Skill 和执行位置：

| task_type | Skill | 位置 |
|-----------|-------|------|
| `dev` | `/dev` | US（Opus） |
| `review` | `/review` | US（Sonnet） |
| `qa` | `/qa` | US（Sonnet） |
| `audit` | `/audit` | US（Sonnet） |
| `code_review` | `/code-review` | US |
| `arch_review` | `/arch-review` | US（Sonnet） |
| `architecture_design` | `/architect` | US（Opus） |
| `initiative_verify` | `/arch-review` | US（Sonnet） |
| `strategy_session` | `/strategy-session` | US（Opus） |
| `decomp_review` | `/decomp-check` | US（Haiku） |
| `explore` | `/explore` | HK（快速） |
| `research` | `/research` | HK |
| `talk` | — | HK |
| `data` | — | HK（N8N） |
| `codex_dev` | `/dev` | 西安 Mac mini |
| `codex_qa` | — | 西安 Mac mini |

---

*生成时间：2026-03-28 | 共 44 Skills*
