# Learning — /dev SKILL 强制 smoke.sh + 4 CI lint job

**分支**：cp-0426202402-cicd-a-skill-lint
**日期**：2026-04-26
**Team**：cecelia-cicd-foundation
**Task**：#1 — A — /dev SKILL 强制 smoke.sh + 4 个 CI lint job

---

### 背景

历史上 Brain 多次出现"单元测试全绿但真启动崩"的事故：merge-resolve 级 SyntaxError、容器化后 host.docker.internal 解析失败、迁移漏跑、deploy 后 server 起不来。CI 跑 vitest mock 不挂真服务，覆盖不到这类系统级行为盲区。

光在文档里写"应该写 smoke.sh"没用，AI agent 跑 /dev 时会跳过。规则不机器化 = 规则不存在。

### 根本原因

1. **纪律靠人盯不可持续** — 主理人每周抽查 PR 是否补 smoke.sh，遗漏率 30%+
2. **TDD 顺序无强制** — subagent 经常先写实现再补测试，commit 1 = impl + test，违反 fail-test-first
3. **stale base 合并冲突** — PR 落后 main 太多，rebase 时丢测试或丢逻辑
4. **新 src 不配 test** — brain v2 抽出模块时多次出现 src 文件无对应 test 文件

### 修复

把 4 条规则全部机器化进 CI：

- `lint-test-pairing` — 新增 brain/src/*.js 必须配套 *.test.js（同目录或 __tests__/）
- `lint-feature-has-smoke` — feat: + 改 brain/src → 必须新增 packages/brain/scripts/smoke/*.sh
- `lint-base-fresh` — 落后 main > 5 commits → 强制 rebase
- `lint-tdd-commit-order` — 含 src 的 commit 之前 PR 系列必须有 *.test.js commit

实现 = 4 个独立 bash 脚本 in `.github/workflows/scripts/lint-*.sh`，CI 调用同时主理人也能本地预跑。

SKILL.md 增加「smoke.sh 必须」段把规则文字化，CI lint 把规则机器化，双保险。

### 下次预防

- [ ] 每个新强制规则先写 lint script，再写文档，再上 CI
- [ ] 新 lint 在自身 PR 上自验证（本 PR 4 个 lint 全自验 PASS）
- [ ] 规则更新时同步更新 SKILL.md + ci.yml + lint script，三处一致
- [ ] 后续 lint 失败的 PR 由 lint 脚本输出明确修复指令（已实现：每个 lint 失败时打印具体修复命令）

### 关联

- Task #2 — real-env-smoke CI job（起 docker compose 跑 smoke.sh）
- Task #3 — brain-deploy.sh post-deploy smoke
- Task #4 — 3 个 smoke.sh 范本（E1 observer / D tick / content-pipeline 幂等）
