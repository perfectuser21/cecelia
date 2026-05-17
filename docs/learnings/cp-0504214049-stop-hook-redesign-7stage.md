# Learning — Stop Hook 7 阶段重设计（2026-05-04）

分支：cp-0504214049-stop-hook-redesign-7stage
版本：Engine 18.19.3 → 18.20.0
前置 PR：cp-0504205421-stop-allow-fix (#2761) — 9 段闭环
本 PR：第 10 段（按段计）

## 故障

今晚 wave2 PR 三连（#2762/#2763/#2764）实战暴露 stop hook 4 个设计盲区：

PR #2764 CI 实际 conclusion=failure（brain-unit shard 2 报 monitor-loop.js:110 row undefined）但 stop hook 反复反馈"启 auto-merge"。verify_dev_complete 用 `gh run list ... --json status` 取 status="completed" 直接判定 CI 通过。GitHub 因 CI 红 BLOCKED 拒绝合并 → stop hook 反复反馈 auto-merge 死循环。

## 根本原因

### 盲区 1：CI status vs conclusion

`gh run list --json status` 只看过程态（in_progress/completed），不看结果态（success/failure）。CI failed run 也是 completed status，被旧 verify 当绿。

### 盲区 2：CI 失败时无 retry 反馈协议

旧 verify 没 P3 分支。CI 红时 assistant 拿不到"修哪个 fail job、看哪条 log"信号，只能靠 stop hook 反复反馈 auto-merge（错误指令）耗时间。

### 盲区 3：merge 后无 deploy workflow 验证

cleanup.sh 内 deploy-local.sh 是 fire-and-forget（setsid &），verify_dev_complete 不监听 brain-ci-deploy.yml workflow run conclusion。merge 完 deploy 是否成功无人盯，stop hook 在 cleanup.sh exit 0 就放行。

### 盲区 4：无 health 探针

没有 GET /api/brain/health 200 验证。cleanup.sh exit 0 ≠ deploy 成功 ≠ Brain 服务存活。

## 本次解法

verify_dev_complete 重写为 7 阶段决策树（packages/engine/lib/devloop-check.sh:541-700+）：

```
P1 PR 未创建 → P2 CI 进行 → P3 CI 失败 (新) → P4 未合 →
P5 deploy workflow (新) → P6 health probe 60×5s (新) → P7 Learning → P0 done
```

**信号源全部走 GitHub API + HTTP probe**，不再读 .dev-mode 字段（merge 后 .dev-mode 可能被 stop hook 自删，单一信号源不可靠）。

**向后兼容**：P5/P6 默认 disabled，靠 env var `VERIFY_DEPLOY_WORKFLOW=1` / `VERIFY_HEALTH_PROBE=1` 启用。这让现有 21 unit case 全过（regression-free），新行为按调用方需要启用。

**P3 关键修复**：CI conclusion=failure 时反馈给 fail job 名 + log URL：

> "PR #N CI 失败（failure）：brain-unit (2)。看 log: gh run view 12345 --log-failed (https://...)。修代码 → commit → push 触发新 CI"

assistant 拿到这个反馈能直接 `gh run view --log-failed` 看错误，修代码 commit push，CI 重跑。这是今晚 wave2 死锁的根本解。

附带 `packages/brain/src/monitor-loop.js:107` row undefined guard（一行 `|| {}`），main 自带 bug，wave2 PR #2764 间接触发暴露。

## 下次预防

- [ ] 用 GitHub API 判 CI 状态时**必须用 conclusion**，不要只看 status
- [ ] CI 失败时反馈给具体 fail job 名 + log URL，让 assistant 能直接 `gh run view --log-failed`
- [ ] 异步触发的 workflow（如 deploy）必须在 verify 链路里监听 conclusion，不能 fire-and-forget
- [ ] 部署成功 ≠ 服务健康，必须 HTTP /api/brain/health 200 探针
- [ ] verify 链路改造必须保留向后兼容 env flag，避免 regression
- [ ] stop hook 信号源**不依赖** .dev-mode 字段（merge 后会被 stop hook 自删）

## 后续段（不在本 PR）

留 Task 3/5/6 给独立 PR：
- 28 unit case 完整扩 P3/P5/P6 mock（需重写 stub 区分 --json 字段）
- cleanup.sh 解耦 deploy-local.sh
- smoke + integration 真链路覆盖（需真起 Brain）

## 验证证据

- 21 unit case `verify-dev-complete.test.sh` 全过（regression-free）
- monitor-loop guard 2 case + cycle 30+ case 单测
- E2E 3 场景骨架（P3/P5/P6 待 stub 扩展后启用）
- smoke.sh 骨架就位
- Engine 8 处版本文件同步 18.20.0

## Stop Hook 完整闭环（10 段）

| 阶段 | PR | 内容 |
|---|---|---|
| 4/21 | #2503 | cwd-as-key 身份归一 |
| 5/4 | #2745 | 散点 12 → 集中 3 |
| 5/4 | #2746 | 探测失败 fail-closed |
| 5/4 | #2747 | 三态出口严格分离 |
| 5/4 | #2749 | condition 5 真完成守门 |
| 5/4 | #2752 | Ralph Loop 模式 |
| 5/4 | #2757 | 50 case 测试金字塔 |
| 5/4 | #2759 | PreToolUse 拦截 |
| 5/4 | #2761 | done schema 修正 |
| 5/4 | **本 PR (#2766)** | **7 阶段决策树 + monitor-loop guard** |
