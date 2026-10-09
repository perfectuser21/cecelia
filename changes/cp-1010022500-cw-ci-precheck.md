## Brain {VERSION} — coding harness：build 内 CI 门禁本地预检，红了带日志修复后再推

- 决策 a1fdbc51 审计 P1 #4（对应旧 harness「CI 门禁三件套前置进 generator 验收」）：build 写完代码、过完后置检查后，在 worktree 里跑 ci-passed 依赖的、能本地离线复现的规矩类门禁（lib/ci-precheck.mjs：配对测试、feat 必带 smoke、TDD 提交顺序、测试质量、禁纯 mock、禁假测试、GP 锚点、分支命名、registry、迁移版本唯一、PR 大小）；红了起修复会话（prompts/ci-precheck-fix.md）至多 2 轮，每轮修完重新过全部后置检查（改合同/历史/agent 配置照样 fatal）；修不好不卡链路，outputs.ci_precheck 标明未过的门禁，交 CI 与 CI 修复环兜底。
- feature 判定与 publish 的 PR 标题同一判据（新增 lib/pr-kind.mjs，publish 改用它）：feat PR 预检时传 PR_LABELS=feature，本地就能测出「改了 brain/src 必须带 smoke」。
- build 提示词写明这些 CI 规矩，争取一次写对；build 预算 2400s → 3600s。
- 真实仓库实测：11 项门禁全部可运行，耗时约 2 秒。
