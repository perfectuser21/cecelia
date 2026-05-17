# Integration Guide

## 集成到现有项目

### 步骤 1: 添加 Submodule

```bash
cd your-project
git submodule add git@github.com:zenjoymedia/cecelia-quality.git infra/quality
git submodule update --init --recursive
```

### 步骤 2: 运行本地安装

```bash
bash infra/quality/scripts/install-local.sh
```

这会自动：
- 创建 `.claude/settings.json`
- 配置 hooks 和 skills 路径
- 复制 contract 模板到 `contracts/`

### 步骤 3: 验证安装

```bash
# 检查 skills
ls -la infra/quality/skills

# 检查 hooks
ls -la infra/quality/hooks

# 测试 hook（应该看到分支保护消息）
git checkout main
# 尝试编辑文件会触发 hook
```

### 步骤 4: 配置 Contracts

编辑以下文件以匹配你的项目：

1. `contracts/gate-contract.yaml`
   - 定义你的 Gate 红线
   - 6大红线可以保持不变

2. `contracts/regression-contract.yaml`
   - 添加你的业务 RCI
   - 按 H/W/C/B 分类

### 步骤 5: 配置 CI

在 `.github/workflows/ci.yml` 中集成质量检查：

```yaml
name: CI

on:
  pull_request:
    branches: [main, develop]

jobs:
  quality-gates:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: recursive

      - name: DevGate Checks
        run: |
          bash infra/quality/scripts/devgate/check-dod-mapping.cjs
          bash infra/quality/scripts/devgate/require-rci-update-if-p0p1.sh
          bash infra/quality/scripts/devgate/scan-rci-coverage.cjs

      - name: Gate Tests
        run: bash infra/quality/scripts/run-gate-tests.sh

  tests:
    needs: quality-gates
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm test
```

---

## 升级 Quality Platform 版本

### 查看当前版本

```bash
cd infra/quality
cat VERSION
```

### 升级到最新版本

```bash
cd infra/quality
git fetch
git checkout main
git pull
```

### 升级到特定版本

```bash
cd infra/quality
git fetch
git checkout v1.2.0
```

### 锁定版本（推荐生产环境）

```bash
cd infra/quality
git checkout v1.0.0
cd ../..
git add infra/quality
git commit -m "chore: lock quality platform to v1.0.0"
```

---

## 多项目共享

### 方案 A: 全局安装（推荐个人开发）

```bash
cd /path/to/cecelia-quality
bash scripts/install.sh
```

所有项目自动共享 `~/.claude/hooks` 和 `~/.claude/skills`。

### 方案 B: Submodule（推荐团队协作）

每个项目独立添加 submodule：

```bash
# 项目 A
cd project-a
git submodule add git@github.com:zenjoymedia/cecelia-quality.git infra/quality

# 项目 B
cd project-b
git submodule add git@github.com:zenjoymedia/cecelia-quality.git infra/quality
```

不同项目可以锁定不同版本。

---

## 自定义配置

### 禁用某个 Hook

编辑 `.claude/settings.json`：

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": []  // 禁用 branch-protect
      }
    ]
  }
}
```

### 添加项目特定 Skills

保持 Quality Platform skills，添加项目 skills：

```json
{
  "skills": {
    "paths": [
      "./infra/quality/skills",
      "./skills"  // 项目特定 skills
    ]
  }
}
```

### 覆盖 DevGate 脚本

创建 `scripts/devgate/` 目录，放入自定义脚本。项目脚本优先级高于 Quality Platform。

---

## 故障排除

### Hook 不触发

1. 检查 `.claude/settings.json` 配置
2. 检查 hook 文件权限：`chmod +x infra/quality/hooks/*.sh`
3. 检查 Claude Code 版本：`claude -v`

### Skills 找不到

1. 检查 `.claude/settings.json` 的 `skills.paths`
2. 检查 submodule 是否正确初始化：`git submodule status`
3. 手动更新 submodule：`git submodule update --init --recursive`

### DevGate 脚本报错

1. 检查 Node.js 版本：`node --version`（需要 >= 16）
2. 检查脚本权限：`chmod +x infra/quality/scripts/devgate/*.sh`
3. 检查依赖：某些脚本需要 `jq`、`yq` 等工具

---

## 最佳实践

### 1. 锁定版本

生产环境锁定 Quality Platform 版本：

```bash
cd infra/quality
git checkout v1.0.0
```

### 2. 定期升级

每个 Sprint 检查新版本：

```bash
cd infra/quality
git fetch
git log --oneline HEAD..origin/main
```

### 3. 测试后再合并

在测试分支验证新版本：

```bash
git checkout -b test-quality-v1.1
cd infra/quality
git checkout v1.1.0
cd ../..
# 测试...
git checkout develop
git merge test-quality-v1.1
```

### 4. 保持 Contracts 独立

不要修改 `infra/quality/contracts/*.template.yaml`，只修改项目的 `contracts/*.yaml`。

---

## 相关文档

- [Architecture](./ARCHITECTURE.md)
- [Customization](./CUSTOMIZATION.md)
- [README](../README.md)
