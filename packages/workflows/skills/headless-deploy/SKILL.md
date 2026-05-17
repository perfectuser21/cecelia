---
name: headless-deploy
description: 将项目 Skill 软链接部署到无头工作区
trigger: 当需要部署 skill 到 headless 环境时
version: 1.0.0
created: 2026-01-30
---

# Headless Deploy Skill

管理项目 Skill 到无头工作区 (cecelia-workflows) 的软链接部署。

## 核心概念

```
源头：各项目/.claude/skills/<skill-name>/SKILL.md  ← 实际开发维护
部署：cecelia-workflows/.claude/skills/<skill-name>  ← 符号链接
```

**好处**：
- Skill 在各自项目中开发维护
- 无头调用时通过统一入口访问
- 不是全局 skill，有项目归属
- 修改源头自动同步

## 子命令

### /headless-deploy add <project> <skill-name>

将项目 skill 部署到无头工作区。

**示例**：
```bash
/headless-deploy add zenithjoy-creator posts
```

**执行**：
```bash
# 源路径
SOURCE="/home/xx/dev/<project>/.claude/skills/<skill-name>"

# 目标路径（无头工作区）
TARGET="/home/xx/dev/cecelia-workflows/.claude/skills/<skill-name>"

# 创建软链接
ln -sf "$SOURCE" "$TARGET"
```

---

### /headless-deploy list

列出当前已部署到无头工作区的所有 skill。

**执行**：
```bash
ls -la /home/xx/dev/cecelia-workflows/.claude/skills/
```

**输出示例**：
```
posts -> /home/xx/dev/zenithjoy-creator/.claude/skills/posts
qa -> /home/xx/dev/some-project/.claude/skills/qa
```

---

### /headless-deploy remove <skill-name>

移除已部署的 skill（只删除软链接，不删除源文件）。

**执行**：
```bash
rm /home/xx/dev/cecelia-workflows/.claude/skills/<skill-name>
```

---

### /headless-deploy test <skill-name> [subcommand]

测试已部署的 skill 是否能正常无头调用。

**示例**：
```bash
/headless-deploy test posts qa-content
```

**执行**：
```bash
cd /home/xx/dev/cecelia-workflows && claude -p '/<skill-name> <subcommand>

测试内容...' --output-format json
```

---

## 目录结构

```
无头工作区 (cecelia-workflows)
├── .claude/skills/
│   ├── posts -> /home/xx/dev/zenithjoy-creator/.claude/skills/posts
│   ├── qa -> /home/xx/dev/another-project/.claude/skills/qa
│   └── ...
├── headless-working-area/    ← 无头执行的工作目录
└── n8n/workflows/            ← N8N 工作流定义
```

## 当前已部署

| Skill | 源项目 | 用途 |
|-------|--------|------|
| posts | zenithjoy-creator | 金句卡片质检和选择 |

## 注意事项

1. **源项目必须存在** - 软链接指向的源路径必须存在
2. **skill 名称唯一** - 不同项目的同名 skill 会冲突
3. **修改即生效** - 修改源头 SKILL.md 后无需重新部署
4. **N8N 调用格式** - `cd /home/xx/dev/cecelia-workflows && claude -p '/skill-name ...'`
