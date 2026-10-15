# QA 生产文本误判修复

任务：9c85169e-1023-4236-a411-23efa1b4f158。GP-Anchor: none(infra)。

真实 Codex R3 X1 仅用 fs.readFileSync 读取 README 并断言生产 URL 禁例，productionTouches 却把字符串内 curl 和 5221 认成访问。
采用完整命令静态解码和现有有限 AST 证明；生产门显式禁止剥离 health curl 前缀。未知命令仍沿用原生产检测，不扩 AST 白名单。
验收：真实普通/原生封套断言均不命中；真实生产 health 前缀、自定义 production_re、shell 拼接/展开、额外参数、写入/fetch/exec 均维持拦截；原报告与批准不改。
测试策略：纯函数回归先红 2/26，再五文件 249 通过；真实文件缺词退出非零；最终 20 项/50 原生执行仅离线回放，不追认历史通过。
