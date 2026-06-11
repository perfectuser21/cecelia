# Learning — 容器内 REPO_ROOT 用 import.meta.url 算 ≠ 挂载路径

分支：cp-06110945-skill-drift-repo-root
日期：2026-06-11

## 背景

skill-drift 端点生产 snapshot_version 全 null：snapshotDir 用模块级 REPO_ROOT
（new URL('../../../..', import.meta.url)）→ 镜像里 /app，/app 下无 packages/workflows。

### 根本原因

**镜像内的代码路径 ≠ 宿主挂载路径。** 用 import.meta.url 反推 REPO_ROOT 得到的是「代码住在哪」
（/app），而需要读的文件是宿主 repo 通过 bind-mount 挂进容器的绝对路径
（/Users/administrator/perfect21/cecelia/...）。deploy 早就把这个挂载路径设进了 env REPO_ROOT，
但本端点没用它，自己用 import.meta.url 重算 → 指向错地方。SSOT 侧没踩坑是因为它走 homedir()
（Dockerfile ENV HOME 对齐过宿主），恰好命中挂载。

### 下次预防

- **要读"宿主 repo 里的文件"的运行时代码，用 process.env.REPO_ROOT（deploy 注入的挂载路径），
  不要用 import.meta.url 反推**——后者在容器里指向镜像内代码目录，不是挂载点。
- 仓库已有惯例 `process.env.REPO_ROOT || '<fallback>'`（zombie-cleaner / emergency-cleanup /
  startup-recovery），新代码读 repo 文件应沿用，而不是各自 new URL 反推。
- 只读端点这类"看着无副作用"的功能，生产环境路径假设也要验（容器 docker exec 实测路径存在性）。

## checklist

- [ ] 运行时读宿主 repo 文件用 process.env.REPO_ROOT，不用 import.meta.url 反推
- [ ] 沿用仓库 REPO_ROOT env 惯例，不各自重算
- [ ] 路径假设在目标容器里 docker exec 实测验证
