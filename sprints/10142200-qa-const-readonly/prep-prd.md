# Bug PrepPRD：const 路径只读断言被误要求截图

任务：9c85169e-1023-4236-a411-23efa1b4f158（根已认领并委派）；GP-Anchor: none(infra)。

## 症状与根因

Canary 3a27ca36 的 QA r2 第三次原报告 22 项与 61 条原生命令完全绑定，截图门误拒 T14/15/16/17/18/19/21。有限 AST 只允许 readFileSync 直接 Literal 路径，不接受 const p 绑定；JSON 数据成员或 find 返回值的 ! 运算也被拒。

## 修法与边界

只记录按语法顺序声明的 const 直接字符串 Literal，在当前作用域内用于同一静态路径校验；不支持别名、拼接、动态值、可变绑定或局部变量冒充静态路径。仅已证明的 JSON.parse 纯数据允许 ! 和 if 真值判断；逻辑表达式仍只接受布尔操作数，避免错误的返回类型授权其他调用。

不改截图、生产、dry-run、原生证据门，也不改 runtime 依赖。两份 evaluate 提示词给合同限定的完整静态文档断言形状，未知继续保守拒绝；这不能代替功能或浏览器验收。根 Challenger 已要求作用域、解码路径、JSON 原型、完整 shell 和真实文件反例；zenithjoy_canary 独审最终 SHA。

## 测试与验收

- 原报告全部 items 及原生记录只读回放；有效首红 aadafcce1 为 15 红 / 52 绿，生产代码未改。首份 red.log 另有 T19 夹具子串重叠误报，已保留并排除，以 red-valid.log 为有效依据。
- 当前解析器上新安全反例先为绿；修后全部回归仍需绿。真实隔离文件原文读取、逐词缺失、JSON 缺成员/篡改/缺文件均核退出码与文件未修改。
- 提示词的示例必须同时过有限 AST 和既有 dry-run 守卫，并真实执行缺词负例。
- 精确原报告 22 项在全部原始 executions 下截图误报为零；原生匹配、生产与恒真检查保持。
- 邻接解析/QA/evaluate/transcript 测试与必需 CI 通过后，交独立审查；仅开 PR，不合并或开启自动合并。

证据目录：`~/.codex-team1/artifacts/codex-primary-20261014/qa-const-readonly/`。本次测试结果不代表 canary 新一轮 QA 或独立裁判通过。

实现后 7 个相邻文件 306 项通过；after.json 对同一 22 项原报告与 61 条真实执行回放，截图误报 7→0，unverified/trivial/production 均为空。独立审查与远端 CI 尚待，不预写通过。
