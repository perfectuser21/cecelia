---
id: skill-versioning
version: 1.1.0
created: 2026-01-19
updated: 2026-01-19
changelog:
  - 1.1.0: 新增 A+C 归档策略（日常靠 git，major 版本归档）
  - 1.0.0: 初始版本，支持 .md 文件的 frontmatter 版本管理
---

# /versioning - 文件版本管理

> 给文件添加/更新 frontmatter 版本号，追踪文档演进

---

## 触发条件

**自动触发**（Claude 应主动执行）：
- 新建 `.md` 文件时
- 修改 `.md` 文件内容时（非小修）
- 重命名文件时
- 重大迭代时

**手动触发**：
- 用户说 `/versioning`
- 用户说"更新版本"、"加版本号"

---

## Frontmatter 格式

```yaml
---
id: <唯一标识>
version: <语义化版本>
created: <创建日期>
updated: <最后更新日期>
changelog:
  - <版本>: <变更说明>
---
```

### 字段说明

| 字段 | 说明 | 示例 |
|------|------|------|
| id | 唯一标识，kebab-case | `dev-step-01-prd` |
| version | 语义化版本 | `1.2.0` |
| created | 首次创建日期 | `2026-01-19` |
| updated | 最后更新日期 | `2026-01-19` |
| changelog | 变更历史（最近 5 条） | `1.0.0: 初始版本` |

---

## 版本号规则

遵循 [Semantic Versioning](https://semver.org/)：

| 变更类型 | 版本变化 | 示例 |
|----------|----------|------|
| 修正错别字、格式调整 | patch +0.0.1 | 1.0.0 → 1.0.1 |
| 新增内容、功能增强 | minor +0.1.0 | 1.0.1 → 1.1.0 |
| 结构重构、破坏性变更 | major +1.0.0 | 1.1.0 → 2.0.0 |

---

## 操作流程

### 1. 新建文件

```markdown
---
id: <根据文件路径生成>
version: 1.0.0
created: <今天日期>
updated: <今天日期>
changelog:
  - 1.0.0: 初始版本
---

# 文件标题
...
```

### 2. 修改文件

```bash
# 1. 检查是否有 frontmatter
# 2. 根据变更类型更新版本号
# 3. 更新 updated 日期
# 4. 追加 changelog（保留最近 5 条）
```

### 3. 重命名文件

- 保留原 id（除非用户要求更新）
- 更新 version（minor +0.1.0）
- 在 changelog 记录重命名

---

## ID 生成规则

根据文件路径自动生成：

| 文件路径 | ID |
|----------|-----|
| `skills/dev/steps/01-prd.md` | `dev-step-01-prd` |
| `skills/dev/SKILL.md` | `dev-skill` |
| `hooks/branch-protect.sh` | `hook-branch-protect` |
| `docs/ARCHITECTURE.md` | `doc-architecture` |

**规则**：
1. 去掉扩展名
2. 用 `-` 连接路径层级
3. 全小写
4. 去掉重复的 `skill`/`step` 等词

---

## 示例

### 修改前

```markdown
# Step 1: PRD 确定

> 生成产品需求文档...
```

### 修改后

```markdown
---
id: dev-step-01-prd
version: 1.0.0
created: 2026-01-19
updated: 2026-01-19
changelog:
  - 1.0.0: 初始版本
---

# Step 1: PRD 确定

> 生成产品需求文档...
```

---

## 批量添加版本号

对整个目录批量添加：

```bash
# 用户说："给 skills/dev/steps/ 下所有文件加版本号"
# Claude 遍历目录，逐个添加 frontmatter
```

---

## 查询版本

```bash
# 查看单个文件版本
head -10 skills/dev/steps/01-prd.md

# 查看目录下所有文件版本
for f in skills/dev/steps/*.md; do
  echo "=== $f ==="
  grep -A1 "^version:" "$f" 2>/dev/null || echo "无版本号"
done
```

---

## 与其他工具集成

### Claude Desktop
可以通过读取 frontmatter 知道文件版本，决定是否需要重新加载。

### Git
frontmatter 变更会被 git 追踪，可以看到版本演进历史。

### N8N
可以解析 frontmatter 获取版本信息，用于自动化流程。

---

## 版本历史策略（A+C 方案）

### 日常改动（A）
- frontmatter changelog 记录最近 5 条
- 完整历史靠 git：`git log --follow file.md`
- 直接覆盖，不单独归档

### 大版本归档（C）
当版本号升级到 **X.0.0**（major 版本）时，归档旧版本：

```bash
# 归档到 .archive/ 目录
mkdir -p .archive
cp skills/dev/SKILL.md .archive/skill-dev-v1.md

# 然后更新原文件到 v2.0.0
```

**归档命名规则**：`<id>-v<major>.md`
- `skill-dev-v1.md`
- `dev-step-01-prd-v1.md`

**什么时候归档**：
- 结构重构
- 破坏性变更
- 流程大改

**不需要归档**：
- minor/patch 版本更新
- 内容增补
- 错误修复

---

## 注意事项

1. **只对 .md 文件生效** - 代码文件用 package.json 管理版本
2. **changelog 最多 5 条** - 避免 frontmatter 过长
3. **id 一旦生成不轻易改** - 方便追踪同一文件的演进
4. **小修不必更新** - 修错别字可以不更新版本号
5. **major 版本要归档** - 升级到 X.0.0 时先归档旧版
