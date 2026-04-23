# Phase A — attempt-loop 真循环 Learning

## 做了什么
把 `packages/brain/src/spawn/spawn.js` 从纯 wrapper（31 行）改成真
`for (attempt in 0..SPAWN_MAX_ATTEMPTS)` 循环（~45 行），每次失败调
`classifyFailure` + `shouldRetry` 判三态。激活 P2 PR6 建未接线的 retry-circuit。
spawn.test.js 从 3 cases 扩到 8 cases 覆盖 success / transient×N / permanent /
429 不删 env / shouldRetry false / MAX 边界。

## 根本原因
P2 建了 9 个 middleware 但 spawn.js 仍是"一次 spawn = 一次 attempt"，
retry-circuit 的 classifyFailure/shouldRetry 写好没人调用 → 死代码。spec §5.2
要求真 for 循环，attempt-loop 整合 PR 被 P2 推到最后 Phase A。

## 下次预防
- [ ] middleware 建好未接线的模块，commit message 显式标 "(未接线)"，便于后续整合 PR grep
- [ ] spec §5.2 / roadmap §Phase A 落地前，brainstorming 阶段必查 middleware 的实际调用链（本次就是这样发现 cap-marking + account-rotation 自愈链条，纠正了原 PRD 的 "delete env 换号" 方案）
- [ ] spawn 层改动必测 caller（harness-initiative-runner）不退化，靠 middleware 子树测试覆盖

## 关键决策（偏离原 roadmap）
原 PRD: transient 后 `delete opts.env.CECELIA_CREDENTIALS` 强制换号。
调整为: 不删 env，cap 场景由 cap-marking → next resolveAccount 自动换号；
non-cap transient（ECONNREFUSED/超时）保留同账号重试。理由：单层职责更清晰，
spawn 不跨层修改 env；非 cap transient 换号无益。spec doc §4.1 记录。
