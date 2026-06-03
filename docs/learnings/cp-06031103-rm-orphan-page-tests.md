# Learning：删页不删测试，留下一片 readFileSync 孤儿把 main 反复拖红

分支: cp-06031103-rm-orphan-page-tests
日期: 2026-06-03

## 现象

连续多个 brain PR 的 brain-unit 红，每次挂在一条不同的 sprints/ 测试上，断言一个 dashboard 页面文件
存在/含某字符串。这些页面其实已被 War Room「删历史死页」系列 PR 退役。删一条又冒一条
（HarnessStreamPage → HarnessDetailPage → HarnessPipelinePage…），whack-a-mole，main 长期不稳。

## 根本原因

War Room 退役 dashboard 页面时**只删页面，没删配套测试**。这些测试散落在多个 sprint 目录
（`sprints/tests/ws2/`、`sprints/cecelia-harness-viz/tests/ws3/`、`sprints/cecelia-pipeline-viz-v2/tests/ws3/`、
`sprints/cecelia-sprint-visibility-0528/tests/ws4/`），且都用 `readFileSync(<页面路径>)` 直接读文件
（不是 existsSync 优雅判空），文件没了就 ENOENT 抛错 → 整个测试文件失败 + worker 崩。

两个放大因素：
1. **brain vitest 把 sprints/ 下多个命名 sprint 的 tests 目录都纳入**，删页面的人通常只看 co-located
   测试，扫不到这些远程 sprint 目录里的硬引用。
2. **分散在 4 个不同 sprint 目录**，加上 vitest 分片（shard 1-4），每个 PR 的 rebase base 不同 →
   每次只暴露其中一条，造成"删一条好一会儿又红"的假象，掩盖了"其实有一批"的事实。

## 下次预防

- **退役页面/路由必须成套删**：页面文件 + 所有引用它的测试（含 sprints/、e2e/）+ 路由注册 + 导航入口。
  删前 `git grep <页面文件名>` 全仓扫一遍，把所有 readFileSync/import 它的测试一起删。
- **结构性测试别用 readFileSync 硬读源码路径**：这类"测某文件含某字符串"的测试一旦目标被删/改名
  就变永久红孤儿。要么用 existsSync 优雅跳过，要么改成真正的行为测试。
- **main 连续红且每次换一条同类测试 = 八成有一整批同根因孤儿**，别逐条追，先 `git grep` 把整批挖出来一次清。

### checklist

- [ ] 删源文件前 git grep 全仓引用，连远程 sprint/e2e 测试目录一起清
- [ ] 退役页面成套删（页面+测试+路由+导航）
- [ ] 结构性测试避免 readFileSync 硬读路径，改 existsSync 或行为测试
- [ ] main 反复红换同类测试时，整批挖一次清，别 whack-a-mole
