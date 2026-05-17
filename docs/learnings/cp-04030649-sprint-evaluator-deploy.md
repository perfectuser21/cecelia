# Learning: Sprint 2 — sprint-evaluator skill 部署到 headless session

**分支**: cp-04030649-f26e3e65-c5e6-4d7f-bdaa-7235ed
**任务**: Sprint 2: Evaluator 实战验证
**CI 失败次数**: 0
**本地验证**: 全部 PASS

---

### 根本原因

`packages/workflows/skills/sprint-evaluator/` 和 `sprint-generator/` 存在于仓库中，但未部署（软链接）到 `~/.claude-account1/skills/`。

Brain 在派发 `sprint_evaluate` 任务时，executor.js 生成的 prompt 以 `/sprint-evaluator` 开头——headless session 使用 `CLAUDE_CONFIG_DIR=~/.claude-account1`，只能识别该目录下已有软链接/目录的 skill。未部署 = `/sprint-evaluator` 无法被识别 = harness 循环断链。

其他 workflow skills（architect、cecelia 等）已有真实目录副本，但新增的 sprint-* skills 只在 workflows 源目录，未同步到 account skills 目录。

---

### 下次预防

- [ ] 新增任何 `packages/workflows/skills/` 下的 skill，必须同时运行 `bash packages/workflows/scripts/deploy-workflow-skills.sh` 确保本地部署
- [ ] `deploy-local.sh` 现在会在 `packages/workflows/skills/` 有变更时自动调用部署脚本——走正常 PR 合并流程会自动处理
- [ ] Harness v2.0 新 task_type 对应的 skill 名称必须在 `skills-index.md` 任务路由表中注册
