# Learning：BYPASS Layer 1 CI gating gap + integrity 元守护

## 背景
PR #2835 BYPASS 三层防御加了 `lint-bypass-not-committed` job 但漏接 `ci-passed needs[]`。结果：lint 跑了、fail 了，但 ci-passed 不依赖它 → PR 仍能合 → layer 1 git lint 形同虚设。

audit 时一眼看出，是真实 gap。

## 根本原因
PR #2835 改 ci.yml 时只加了 job 定义，没把 job 名追加到 ci-passed.needs[] 列表。CI lint job 必须被 ci-passed 依赖才会真正阻止合并。

## 下次预防

### 下次预防

- [x] ci-passed needs[] 加 lint-bypass-not-committed
- [x] integrity test 加 L19 / L20 / L21 元守护：扫源码守护"fire_bypass_alert / .bypass-active marker / lint 在 needs[]"
- [x] L21 自身防回退：未来谁删了 needs[] 里的 lint-bypass-not-committed，integrity test 立刻 fail
- [ ] **新加 CI lint job 时检查清单**：(1) job 定义 (2) 调用脚本存在 (3) **加到 ci-passed needs[]** ← 最易漏
- [ ] 任何"加新守门 job"的 PR 应同时加对应的 integrity 元测试守护，让 hook 自身的元规则 CI 化

## 元设计观察

stop-hook 现在有三层守护：
- **Code level**：30+ vitest case 测决策行为
- **CI lint level**：check-single-exit + check-bypass-not-committed 静态扫
- **Meta integrity level**：stop-hook-coverage.test.sh 21 条 invariant 守护"测试和 CI 真接通"

L21 是元中元 —— 守护"layer 1 lint 真生效"这一规则本身。
