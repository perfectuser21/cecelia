# Learning: Tier 0 止血 — CI 装样子 / 闭环漏写（2026-04-27）

- 影响：开发流程 foundation 的可信度
- 触发：Alex 反馈"开发流程不稳定 / 整个东西都是虚的"，用 4 agent 并行审计后定位到 5 处致命缝隙

---

### 根本原因

**CI 看起来严格但行动不严格**：

1. `real-env-smoke` 用 `continue-on-error: true` 上线作"软门禁观察期"，原本计划"1 周后切硬"，但**计划没人记**，半个月过去仍是软门禁 → CI 绿不代表真路径绿，几次 prod 挂（server.js merge SyntaxError / smoke 失败 / dispatcher 卡 retired type）都是 CI 绿了之后才发现
2. `harness-v5-checks` 同样的 4 个 job 全是"1 周观察期"软门禁，注释还在但观察期早过 → harness PR 的 DoD 纯度 / Test Contract / TDD 顺序 / 实跑测试 全部形同虚设
3. **闭环回写缺失**：CLAUDE.md §8 写了"PR 合后必须 PATCH /api/brain/tasks/{id}"，engine-ship SKILL 也提到"标记完成"，**但没人真调 curl** → Brain 永远不知道任务真做完没，dispatcher 看队列时永远看到一堆"in_progress"和"queued"，无法基于 done 判断系统状态

**通病**：所有"观察期 / 待办 / 后续修复"性质的临时配置，**只要没设到期 timer，就永远是临时**。

---

### 修复

- ci.yml `real-env-smoke` 删 `continue-on-error: true`
- harness-v5-checks.yml 4 处 `continue-on-error: true` 全删，注释更新
- 新增 `packages/engine/skills/dev/scripts/callback-brain-task.sh`：真调 PATCH，自动从 .dev-mode 读 task_id，无 task_id / Brain 不可达时静默 skip 不阻塞 ship

user-scope `~/.claude-account3/skills/engine-ship/SKILL.md` 需要手动加 1 行 `bash packages/engine/skills/dev/scripts/callback-brain-task.sh --pr "$PR_NUMBER"` —— 在 fire-learnings-event 之后调用。这是 PR 之外的手动动作。

---

### 下次预防

- [ ] 任何"观察期" / "TEMP" / "1 周后切硬" 的 CI 配置必须**带到期日期注释**（YYYY-MM-DD），过期 lint 自动告警
- [ ] 新增 CI lint 不允许 `continue-on-error: true`，除非 PR 描述明确给出到期日 + 责任人
- [ ] CLAUDE.md / SKILL.md 中"必须做 X"的规则**必须有对应的 lint / hook / script 真执行**，否则降级为"建议"标签
- [ ] 凡在 SKILL.md 文档里写的"自动化动作"，必须在 packages/engine/skills/<skill>/scripts/ 下有对应可执行脚本（grep 验：每条"自动"动作 → 必须有 .sh 入口）
