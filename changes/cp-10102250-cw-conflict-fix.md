## Brain {VERSION} — coding harness：runner 处理与 main 冲突的 cw PR

- 金丝雀 4 的 PR #6232：真人 QA 与独立裁判都通过后，runner 推了记录提交，PR 却和 main 冲突（smoke-allowlist.txt 两边都在末尾追加，加上 main 占了 544 迁移号）。冲突的 PR 不跑 pull_request CI，必需检查永远出不来：CI 修复找不到失败检查，合并门也等不到绿灯，runner 只是静默空转。
- CI 修复找目标时，先认出 mergeable=CONFLICTING 的 cw PR，在 PR 分支上合并 origin/main：
  - smoke-allowlist / smoke-write-targets 这类只追加的登记表按并集合并，由程序完成，不派 claude；
  - 还有冲突才派修复会话（新 prompt conflict-fix）解决并完成合并；
  - 迁移编号与 main 撞了，就把本 PR 的迁移顺延到下一个空闲编号。
- 核对只看 PR 自身相对 main 的改动：main 带进来的 sprints/ 和测试不算受保护路径或削弱测试。
- QA 通过的处理：改到 PR 自身代码时撤销 QA 通过、关掉自动合并，新 head 重新 QA 加裁判；只合了登记表就保留通过，交给合并门改绑。
- 冲突修复每个 PR 最多 3 次，不占 CI 修复次数。同一 head 合过没成，或次数用完，就升级（conflict_unresolved / conflict_exhausted）。
- 测试：新增 run-once-conflict.test.mjs，覆盖登记表并集合并、代码冲突派 claude 并撤销 QA、合并未完成后升级、不占 CI 修复次数四种情况。
