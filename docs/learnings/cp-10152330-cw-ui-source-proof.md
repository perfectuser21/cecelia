# 工作区消费者来源补证（2026-10-15）

## 根本原因

普通 import 图遗漏 CI 选择器、npm 执行与 TSX 测试的实际消费入口，导致三个真实组件无法反向到既有 F3 binding。初版手写 AST 形状又遗漏 isTypeOnly、using 和编译器注释，独审用真实 Git 对象证明了假覆盖。

## 下次预防

- [x] fixedworkspaceproof 补图只以固定 Git 文件和原冻结 verified binding 为锚，核 repo/revision/digest；未知结构不加边，不能删辅助关系或改历史 snapshot 洗绿。
- [x] completeinputbytes 有限封套保留完整测试/config/setup 原文，不能只取 AST 子节点忽略语义属性或注释；生产组件必须存在真实非 ambient 出口，正文无需锁死。
- [x] effectivevitestentry CI 选择器、npm 行为字段、生命周期、消费路径编译配置及实际锁解析共同决定真实消费者；root Vitest 版本不能替代 API 的执行合同。
- [x] trustedparserinstallation 工具依赖应归属实际安装它的 CI 包；Brain 单包读者不应因未使用的解析器顶层导入崩溃。固定可信解析器版本并延迟加载，适用证明缺失依赖必须明确失败，不能跳过测试或借候选依赖。
- [x] actuallockconsumer npm workspace 的 cwd 不能证明独立 lock 被解析；固定执行封套与隔离安装实验共同核对消费路径。根安装输入和 setup-node 缓存键分别记边，不能把缓存读取冒充 npm 解析或测试通过。
- [x] bootstraptruth 原 trusted 工具 FAIL、新工具候选 PASS、正式发布、业务样本是不同证据。明确例外批准前不得凭 required-check 缺口自动合并。

本文件是本棒待交付 Learning，尚未写入 Brain，不重发此前 54 条。有限封套任何格式/注释改变都可能要求重新审查；不声明通用 TSX 覆盖或长期无人稳定，样本仍 0/2。
