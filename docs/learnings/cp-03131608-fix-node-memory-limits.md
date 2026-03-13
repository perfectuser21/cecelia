---
id: learning-fix-node-memory-limits
version: 1.0.0
created: 2026-03-13
updated: 2026-03-13
changelog:
  - 1.0.0: 初始版本
---

# Learning: 固化 Node.js 内存上限——Linux Docker cgroup 隐藏的配置缺口（2026-03-13）

## 根本原因

Brain 从 Ubuntu VPS（Linux Docker）迁移到 US Mac mini M4（macOS bare metal）后，接连发生三波 OOM 崩机。根本原因是：

- Linux 上跑在 Docker 容器里，`mem_limit: 4G` 通过 cgroup 限制内存，Node.js 自动感知容器限制并设置合理的 V8 堆上限。
- macOS 无 cgroup，Node.js 看到完整的 16GB 统一内存，V8 堆上限自动设为 ~12GB，完全没有约束。
- `vitest.config.js` 注释中写着"依赖 NODE_OPTIONS 限制每 fork 3GB"，但这个 `NODE_OPTIONS` 只在 CI workflow YAML 里设置（`ci-l4-runtime.yml`），**从未写进 `package.json` 的 test script**。
- 本地 `npm test` 裸跑：没有 cgroup 保护 + 没有 NODE_OPTIONS → vitest fork 进程无内存上限 → macOS OOM。

## 修复内容

| 文件 | 修复 | 层级 |
|------|------|------|
| `packages/brain/package.json` | `test/test:coverage` 加 `NODE_OPTIONS='--max-old-space-size=3072'` | L1（必修） |
| `packages/brain/Dockerfile` | CMD 加 `--max-old-space-size=3072` | L2 |
| `docker-compose.yml` (node-brain) | `deploy.resources.limits.memory: 4G` | L2 |
| `packages/engine/package.json` | `test/test:coverage` 加 `NODE_OPTIONS='--max-old-space-size=2048'` | L2 |
| `packages/quality/package.json` | `test` 加 `NODE_OPTIONS='--max-old-space-size=2048'` | L2 |
| `apps/api/package.json` | `test` 加 `NODE_OPTIONS='--max-old-space-size=2048'` | L2 |
| `docker-compose.yml` (frontend) | `deploy.resources.limits.memory: 256M` | L2 |

## 教训

**不要依赖外部环境变量来控制关键行为**——把内存限制固化到 `package.json` 里，本地、CI、Docker 任何环境都有保障。

Linux 的 Docker cgroup 掩盖了这个配置缺口长达数月，迁移到 macOS 才把它彻底暴露。

## 下次预防

- [ ] 新增 vitest 配置时，检查 `package.json` 是否已包含对应的 `NODE_OPTIONS`，不能只靠 CI workflow 环境变量
- [ ] 跨平台迁移（Linux Docker → macOS bare metal）前，逐项检查依赖 cgroup/kernel 特性的配置
- [ ] Brain 的 vitest.config.js 中有 `// 依赖 NODE_OPTIONS` 注释时，视为 TODO，必须在 package.json 中落地
