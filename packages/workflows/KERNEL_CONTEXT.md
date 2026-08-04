# KERNEL_CONTEXT — 硬规则正本（Kernel 唯一权威来源）

> **角色定义**：本文件是 Cecelia 系统硬规则（Hard Rules）的**唯一正本**（SSOT）。
> AGENTS.md 和 `.claude/CLAUDE.md` 里的同名 section 均为**镜像副本**，须与本文件逐字一致。
> 校验工具：`scripts/check-agents-rules-sync.sh`（三方对账，任一不等 exit 1）。
>
> **禁止直接修改镜像**：改动须以本文件为准，同步写入所有镜像副本。

---

## 硬规则摘要（Hard Rules Summary）

<!-- HARD_RULES:BEGIN -->
### 语言
1. 所有输出必须使用简体中文，禁止日语、韩语或其他语言。

### 分支与提交
2. 绝对禁止 `git push origin main`。
3. 绝对禁止在 main 分支上 `git add` / `git commit`。
4. 分支策略：`cp-*` / `feature/*` 分支开发 → PR → main，不允许绕过。
5. push 后必须等待 CI 完成，禁止用 `gh pr merge --admin` 绕过 CI 检查。
6. commit message 遵循 Conventional Commits 格式（feat/fix/docs/chore/test/refactor/build/ci/style/perf/revert）。

### 危险操作确认
7. 网络配置变更、分区操作、`docker rm -f` 生产容器、数据库 schema 直改、`ufw deny 22` 等危险操作，必须先告知风险并获得明确确认后才能执行。

### Brain 改动门禁（DevGate）
8. 改动 `packages/brain` 代码前必须依次通过：`node scripts/facts-check.mjs`、`bash scripts/check-version-sync.sh`、`node packages/quality/scripts/devgate/check-dod-mapping.cjs`。
9. DevGate 校验失败时禁止继续编码，必须先修复校验问题。
10. 不允许凭记忆/猜测编造架构、跳过 DevGate、引用已废弃的旧路径。

### 任务追踪
11. 改代码走 `/dev` 流程（bug 修复 / 小改动 / 大功能三条路径）。
12. 任务生命周期状态通过 Brain API（`localhost:5221`）管理，不使用临时 ad-hoc 状态记录。

### 决策留痕
13. 用户做出的实质性决策必须写入 Brain `decisions` 表，不放进 memory 或 CLAUDE.md。

### 代码规范
14. 禁止创建 `*New.tsx` / `*Old.tsx` / `*Backup.*` 等临时版本文件。
15. 禁止在仓库根目录堆放临时脚本。
16. 不主动创建 markdown 文档，除非用户明确要求。
17. 单文件超过 500 行需拆分；同一段逻辑重复出现 3 次以上需提取为函数。
18. 完成任务后必须清理调试用的 `console.log`、注释掉的死代码、未使用的 import。

### Bug 修复流程
19. 修 bug 前必须先写一个能复现该 bug 的 failing test。
20. 该 failing test 修复后必须永久保留在 CI 里作为回归测试，不能删除。

### 验收标准
21. 功能验收必须验证真实产出效果（例如：视频类功能用 ffprobe 验证真实视频/音频流；数据写入类功能查数据库确认记录存在），不能仅凭"测试通过"这类空泛断言收尾。

### 凭据管理
22. API Key / Token / 密钥等凭据一律不提交进 git；`.gitignore` 必须排除 `.env` / `*.key` / `*.pem` 等敏感文件模式。

### AI 自我检测
23. 当输出中出现"手动/您可以/暂时禁用/等待用户/绕过/临时/跳过/忽略/先不管/稍后"这类推诿性措辞时，必须停下重新分析并自动解决问题，不能把困难推给用户。
<!-- HARD_RULES:END -->
