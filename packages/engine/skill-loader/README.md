# Skill Loader - 技能加载器

## 概述

Skill Loader 是一个注册机制，用于管理 Cecelia Engine 的 skills。

**核心功能**：
- 支持 Multi-repo（当前）和 Monorepo（将来）
- 统一管理所有 skills 的加载
- 平滑迁移，只改配置不改代码

## 使用方式

### 加载所有 Skills

```bash
cd /home/xx/perfect21/cecelia/engine
node skill-loader.cjs load
```

### 列出已注册 Skills

```bash
node skill-loader.cjs list
```

### 验证安装状态

```bash
node skill-loader.cjs verify
```

## 注册表格式

`skills-registry.json`:

```json
{
  "version": "1.0.0",
  "updated": "2026-02-10",
  "skills": {
    "skill-id": {
      "name": "Skill Name",
      "description": "Skill description",
      "type": "workspace|engine|absolute",
      "path": "relative/or/absolute/path",
      "entry": "command.sh",
      "enabled": true
    }
  }
}
```

### Skill 类型

| 类型 | 路径解析 | 用途 |
|------|---------|------|
| `workspace` | 相对于 engine 目录 | Workspace 中的 skills |
| `engine` | 相对于 engine 目录 | Engine 内置 skills |
| `absolute` | 绝对路径 | 外部 skills |

## 工作原理

```
1. 读取 skills-registry.json
2. 遍历所有 enabled 的 skills
3. 解析路径（根据 type）
4. 创建软链接到 ~/.claude/skills/
5. 处理冲突（备份已存在的目录）
```

## Multi-repo → Monorepo 迁移

### 当前（Multi-repo）

```
/home/xx/perfect21/cecelia/
├── core/          (repo)
├── engine/        (repo)
└── workspace/     (repo)
    └── apps/
        └── platform-scrapers/
            └── skill/
```

**注册配置**：
```json
{
  "platform-scraper": {
    "type": "workspace",
    "path": "../workspace/apps/platform-scrapers/skill"
  }
}
```

### 将来（Monorepo）

```
cecelia/ (单个 repo)
└── packages/
    ├── core/
    ├── engine/
    └── workspace/
        └── apps/
            └── platform-scrapers/
                └── skill/
```

**注册配置**（几乎不变）：
```json
{
  "platform-scraper": {
    "type": "workspace",
    "path": "../packages/workspace/apps/platform-scrapers/skill"
  }
}
```

**只需要修改相对路径，代码不用改！**

## 示例

### 添加新 Skill

1. 编辑 `skills-registry.json`:

```json
{
  "my-new-skill": {
    "name": "My New Skill",
    "type": "workspace",
    "path": "../workspace/apps/my-new-skill/skill",
    "enabled": true
  }
}
```

2. 加载：

```bash
node skill-loader.cjs load
```

3. 验证：

```bash
node skill-loader.cjs verify
ls -la ~/.claude/skills/my-new-skill
```

### 禁用 Skill

```json
{
  "my-skill": {
    "enabled": false
  }
}
```

## 故障排除

### Skill 加载失败

```
❌ Failed to load skill: platform-scraper
   Error: Source path does not exist: ...
```

**解决**：检查 path 是否正确，源目录是否存在。

### 软链接冲突

```
⚠️  Backed up existing: platform-scraper -> platform-scraper.backup.1234567890
```

**说明**：已存在的目录被自动备份，新建软链接。

### 验证失败

```
❌ platform-scraper → /wrong/path
   Expected: /correct/path
```

**解决**：重新运行 `node skill-loader.cjs load`。

## 版本历史

- **1.0.0** (2026-02-10): 初始版本，支持 workspace/engine/absolute 三种类型
