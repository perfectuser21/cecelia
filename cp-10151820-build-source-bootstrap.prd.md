# 固定 build/publish 原生执行来源自举

根任务：427d7e49-27c5-4612-b115-9214f03d47f9。GP-Anchor: none(infra)。

现有来源工具已真实选择 coding-workflow 测试，但没有沿 runActivityProcess 的参数追踪 activity、动态 loadPrompt 模板和测试 CLI。因此 build 意图修复虽回归通过，旧可信来源仍拒绝未归属文件；本棒补齐真实调用证据，不改地图或放宽归属。

独立 revision marker 缺省/0 完全保留旧固定 Git 的全部 bindings/relations。第一棒只支持而不激活。激活时，仅当固定 build/publish 测试被原 include-minus-exclude 真实选中，活跃且非跳过的指定 it 直线调用唯一 run，入口/环境/原生 spawn 封套及保护绑定均证明通过，才登记固定入口。build 继续证明真实已执行 main→loadPrompt→args→runClaude 的 provider/isolateRemote 分支、真实 reader 与 fake CLI。publish 只声明 Node 入口被实际消费，不认领未改 fake GH，也不宣称真实发布成功。

AST 封套来自正式祖先 2eb4d0557365befafed1953140c9c47e20bab495，仅作对照数据，不执行候选源码。build main 只核至首次 runClaude 的关键前缀，允许后续 INTENT_PATH 无副作用变量扩展。动态入口、skip/死支路、参数覆盖、关键对象逃逸、错 provider/reader/bin、未知标记均拒绝。第一棒将 build 假 CLI 测试明确固定 provider=claude，避免继承环境改变实际执行路径。模型服从任务范围仍需第二棒正式加载后新 A2/B 自然验收。

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 |
|---|---|---|
| ws1 | `packages/brain/src/lib/__tests__/existing-ops-build-source.test.js` | `激活后仅沿真实活跃 build 子进程认领活动、模板与假 CLI 输入` |
| ws1 | `packages/brain/src/lib/__tests__/existing-ops-build-source.test.js` | `缺省与0标记读取固定旧Git时保留完整输出逐字一致` |
| ws1 | `packages/brain/src/lib/__tests__/existing-ops-build-source.test.js` | `真实固定封套及第二棒新增 INTENT_PATH 普通参数均可证明` |
| ws1 | `packages/brain/src/lib/__tests__/existing-ops-build-source.test.js` | `现有活跃 publish 子进程在新协议中认领真实入口，不泛化其它活动或假GH` |

注册期递归检查所有 describe：只允许固定根 setup、惰性函数与纯数据初始化，拒绝 only、异步注册、立即调用、未知嵌套 hook 与测试进程控制。输入解析、规格 ID 校验、目录校验、HEAD 查询使用固定小函数 AST 封套，拒绝调用前的确定提前退出；不模拟文件系统或 Git 外部环境成功，真实回归继续负责运行结果。

固定 Git 测试使用本分支直接祖先，正式 CI fetch-depth: 0；无跨分支未合入对象依赖。可信旧2eb4工具应经真实静态 import 认领本棒新纯proof模块，不能候选工具自证；完整来源独审与正式CI后才合并。第二棒须等正式加载与新完整artifact，再激活marker。
