# Learning: 测试毕业无机制 = 规矩必然失守

### 根本原因
07-10 大扫除留下"sprint 测试手动毕业进 src/"的规矩但没有机制与守卫：无搬运脚本、无孤儿计数、无人执行。
四天内新欠 10 个文件，加上大扫除本身没清走的 32 个脚手架，孤儿累计 42。规矩没有配套机器就是祈祷。

### 下次预防
- [ ] harness-report / engine-ship 收尾步接 `scripts/graduate-sprint-tests.mjs`（刀1b，zenithjoy-skills repo 另立 PR）
- [ ] scripts/smoke/e2e/ 池接 nightly 跑道（刀3）
- [x] 孤儿棘轮已锁 0（test-pyramid-guard A1），再晾一个测试 CI 当场红
