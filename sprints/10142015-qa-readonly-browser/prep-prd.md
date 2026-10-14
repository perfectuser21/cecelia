# PrepPRD：只读核对误判浏览器

任务：9c85169e-1023-4236-a411-23efa1b4f158，已认领；锚点 none(infra)。

真实 QA T5/T6 的浏览器词汇只出现在文档/源码读取与断言中，却触发截图守卫。本次显式使用 Acorn 8.16.0，完整解析有限只读 JS；Shell 仅静态 node-e 或已知健康探针完整封套。未知调用/语法仍走原截图要求，不改 dry-run 守卫、native 证据绑定、原合同和服务。

只读语义：const 绑定；静态文本读取；JSON.parse 与 JSON 属性读取；纯 find/includes/比较；失败 throw；静态日志。不运行用户程序来判断是否安全；禁止动态执行、原型访问、可变绑定与命名遮蔽。

运行依赖：仓库显式生产依赖，版本化双依赖 runtime 清单与 lock（Playwright 1.62.1、Acorn 8.16.0）；Codex health 缺失/版本不符拒绝。实际安装与链接切换归根代理，本轮只做隔离验证。

DoD：
- [x] 真实 T5/T6 原文先红后绿，保留失败历史（c74e9d9e3）。
- [x] 真浏览器/副作用/原型/可变与遮蔽反例拒绝，现有守卫回归通过（10文件305项；补充真实文件与参数后定向93项全绿）。
- [x] Codex 依赖缺失/错误版本失败关闭（canonical临时路径首红4391deaf0：2红12绿）。
- [x] 独立双依赖 npm ci、Acorn AST、真实浏览器 DOM 与安装后启动通过；根代理持外锁与内锁切换稳定路径，旧依赖保留。证据 qa-readonly-browser-runtime-deps.json 与 qa-readonly-browser-runtime-install.json。
- [ ] 提交交根与 retire 独审；不 push、不操作生产。

真实隔离文件验收：T5/T6原文node参数逐字执行，完整文本/JSON均成功，缺README均非零；执行前后文件逐字相同。未把这个本地夹具结果冒充正式QA通过。

证据：`~/.codex-team1/artifacts/codex-primary-20261014/qa-readonly-browser/`。首轮health临时路径有macOS symlink与import.meta入口差异，未执行入口的两项失败不算有效首红；更正canonical路径后在旧health实现真实复现，见 `red-health-canonical.log`。T5/T6首红始终有效。
