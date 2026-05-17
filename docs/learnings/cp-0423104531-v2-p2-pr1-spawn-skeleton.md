## v2 P2 PR1 Spawn Skeleton（2026-04-23）

### 根本原因

v2 架构 P2 第一个 PR 要把 `packages/brain/src/spawn/` 目录从零建起来。做法上的核心选择：**先建骨架 + 一个 caller 迁移**，middleware 链全部推后到 PR 2+。这让每个后续 PR 只动一个 middleware + 其自身测试，风险可控；反面典型是想"一把梭" 10 个 middleware + 11 处 caller 全改，单 PR 2000+ 行没人敢审。

Brain 现状不健康（thalamus LLM 欠费，dispatch 瘫痪）让我一度想把 P2 派给 Brain 的 harness 自动跑，走不通后才改走 /dev 手动推。这个迂回让 Alex 明确看到了"Brain 坏了反而挡住自己的重构"这件事，以后 Brain 健康相关的改动默认走手动 /dev，不靠 Brain 自动化。

### 下次预防

- [ ] **禁止"一 PR 搞定多层结构改动"**：P2 的 10 middleware × 11 callers，拆成 11 个独立 PR，每个独立 review / CI，千万别合并省事。同理未来 P3 / P4 也按"一个文件一个 PR"的粒度
- [ ] **Brain 核心改动不派给 Brain 自己**：`feedback_no_core_tasks_to_codex.md` 已有"不派 Codex"，这次再加一条"不派 harness"。Brain 架构级改动一律 `harness_mode:false` 手动 /dev
- [ ] **SPAWN_V2_ENABLED flag 要有回滚真演练**：PR 2+ 接 middleware 后必须手动 `SPAWN_V2_ENABLED=false` 跑一遍 harness E2E 确认 fallback 没坏，别让 flag 变成"以防万一但从没试过"的摆设
- [ ] **1:1 wrapper 阶段的 test 不能被 mock 假过**：本 PR 的 spawn smoke test 全部 `vi.mock(docker-executor)`，测不到真实 docker 路径。PR 2 接 docker-run middleware 时必须加一个真跑 docker 的集成测试（contract test 级别），否则后续 middleware 都是"单测 pass 但集成没测过"的纸老虎
