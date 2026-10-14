# PrepPRD：只读文档断言误判

任务：9c85169e-1023-4236-a411-23efa1b4f158（已认领，根代理授权）。
锚点：none (infra)，coding-workflow QA 证据守卫。

真实 canary 3a27ca36 的 Q1 读取 README 并断言包含 `--dry-run`，却被全文关键字判为假执行。仅为完整静态 `node -e` 命令中的固定只读 Markdown 断言语法提供例外；未知语法继续拒绝。保持吞错、纯回显、原生完成事件、退出码与输出核验，不修改在途合同、README 或服务。

验收：真实 Q1 原文先红后绿；真实临时文档完整时 exit 0，缺词/缺文件时非零；CLI dry-run、嵌套执行、额外语句/参数、模板/注释/动态语法拒绝。零依赖，完整 argv 与 JS 到 EOF；未支持语法可保守误拒，绝不静默扩大范围。

DoD：
- [x] Q1 原样回归通过，原失败日志保留（首红 a8c0ec424，1 失败 / 37 通过）。
- [x] 安全反例及原 QA / evaluate / transcript 回归通过（5 文件 / 160 项）。
- [x] 真实文件正反断言退出码通过（完整文件单/双 shell 引号 exit 0；逐一缺词、缺文件均非零）。
- [ ] 实现提交交根与 retire 独审；本轮不 push / 不开 PR。

验证命令（packages/brain）：`../../node_modules/.bin/vitest run scripts/coding-workflow/__tests__/qa-doc-assertion.test.mjs scripts/coding-workflow/__tests__/qa-report.test.mjs scripts/coding-workflow/__tests__/evaluate.test.mjs scripts/coding-workflow/__tests__/transcript.test.mjs scripts/coding-workflow/__tests__/transcript-shell.test.mjs --maxWorkers=1 --minWorkers=1`。
红绿与 DevGate 原始日志：`~/.codex-team1/artifacts/codex-primary-20261014/qa-doc-assertion/`。
限制：仅支持固定 fs/p/s/x 语句、无转义双引号数据、单行 JS、静态单引号/双引号 shell 参数；未知形式仍拒绝，不作为通用 JavaScript 安全解析器。
