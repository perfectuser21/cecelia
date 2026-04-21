# Learning — Harness v5 Sprint C-b: 老 sprint 归档

### 根本原因

`sprints/` 根目录累积 18 个历史实验 sprint 目录 + 5 个散落根目录的 md 文件——都是 Harness v2/v3/v4 演进过程中留下的"工作纸"，内容是 PRD / 合同草案 / 评估反馈 / harness report（对应代码早已合并到 main）。

v5 上线后继续留着会：
- 新 contributor 打开 `sprints/` 看到一堆不认识的目录分心
- 老合同格式（v4 时代的 `[BEHAVIOR]` 在 `contract-dod-ws` + `node -e` 字符串 Test）可能误触 Sprint C 的 `dod-structure-purity` CI check
- 老 sprint 的 tests 布局（如果有）不符合 v5 `tests/ws{N}/` 规范

### 归档方案

纯 `git mv` 到 `sprints/archive/`：

- 18 个 sprint 目录 → `sprints/archive/<name>/`
- 5 个散落 md（`sprint-prd.md` / `sprint-contract.md` / `sprint-report.md` / `eval-round-1.md` / `ci-coverage-assessment.md`）→ `sprints/archive/root-leftovers/`

`sprints/` 根目录现在只剩 `archive/` 一个子目录，干净。

### 为什么 CI 脚本天然排除 archive

Sprint C 的 3 个检查脚本用的正则：

```
^sprints/[^/]+/contract-dod-ws\d+\.md$
^sprints/[^/]+/(contract-draft|sprint-contract)\.md$
^sprints/[^/]+/tests/.*\.test\.ts$
```

`[^/]+` 只匹配**一级子目录**。归档路径形如 `sprints/archive/<old-sprint>/contract-dod-ws1.md` 是 **3 级深**——正则匹配失败，天然跳过。不需要在脚本里加额外的 archive 过滤。

### 为什么 workflow 仍加 `!sprints/archive/**` 排除

`on.pull_request.paths` 用 glob `sprints/**/...`，`**` 匹配任意深度包括 archive。所以 workflow 会在 archive 改动时被触发（虽然脚本里不会真正扫到文件）。加 `!sprints/archive/**` 防止 workflow 浪费跑一次什么都不检查的空运行。

### 双层防护设计

| 层 | 机制 | 作用 |
|---|---|---|
| workflow paths | `!sprints/archive/**` | archive 改动不触发 workflow 跑 |
| 脚本 regex | `sprints/[^/]+/` 单级目录 | 就算 workflow 跑了也不误报 |

相互独立，一层漏了另一层兜底。

### 为什么拆成独立 PR（Sprint C-b）

按 spec 说明：

> 老 sprint 归档 PR（单独 1 个 PR，不和 CI 改动混）

理由：
- 归档是纯 `git mv`，改动大（18 dir 移动）但无风险
- 如果和 CI 改动（Sprint C）混：CI 新 check 扫到老 sprint 数据可能误报；排障时混淆来源
- 拆开：先合 CI（Sprint C 已合），后合归档（本次），独立可回滚

### 下次预防

- [ ] 观察期（Sprint C 软门禁 1 周）内如有 harness PR 跑过 `dod-structure-purity` 不误报 archive → 确认天然排除有效
- [ ] 未来有新的老 sprint 产生（dogfood 测试等）要及时归档，不让 `sprints/` 根目录再次混乱
- [ ] 归档目录永远不删——git history 保留，但禁止在 archive 下**新增**或**修改**文件（否则 workflow 排除规则可能失效，脚本 regex 也可能误触）

### 关键事实

- **本次归档**：18 sprint 目录 + 5 散落 md
- **保留位置**：`sprints/archive/<name>/` 和 `sprints/archive/root-leftovers/`
- **git 历史保留**：每个文件的 commit 历史完整（git mv 保留）
- **CI 软门禁观察期**：从 Sprint C 合并起算 1 周（目标 2026-04-28 左右切硬）
