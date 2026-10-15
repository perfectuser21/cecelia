# 活动执行来源与双 scope 联合归属修复

根任务：427d7e49-27c5-4612-b115-9214f03d47f9。GP-Anchor: none(infra)。

现有来源工具已真实选择 coding-workflow 测试，但没有沿 runActivityProcess 的参数追踪 activity、动态 loadPrompt 模板和测试 CLI。因此 build 意图修复虽回归通过，旧可信来源仍拒绝未归属文件；本棒补齐真实调用证据，不改地图或放宽归属。

同一 PR 同时修复双 scope 中无自有变更的合法切片：保留完整原始双来源、逐文件 foreign 解释和全部已登记真实断言，联合无主文件仍拒绝。该窄合同与反例详见 `cp-10152055-scope-no-owned.prd.md`。

独立 revision marker 缺省/0 完全保留旧固定 Git 的全部 bindings/relations。第一棒只支持而不激活。激活时，仅当固定 build/publish 测试被原 include-minus-exclude 真实选中，活跃且非跳过的指定 it 直线调用唯一 run，入口/环境/原生 spawn 封套及保护绑定均证明通过，才登记固定入口。build 继续证明真实已执行 main→loadPrompt→args→runClaude 的 provider/isolateRemote 分支、真实 reader 与 fake CLI。publish 只声明 Node 入口被实际消费，不认领未改 fake GH，也不宣称真实发布成功。

AST 封套来自正式祖先 2eb4d0557365befafed1953140c9c47e20bab495，仅作对照数据，不执行候选源码。build main 只核至首次 runClaude 的关键前缀，仅允许后续已审 INTENT_PATH:path.join(dir,INTENT_FILE) 扩展并核特定导入。动态入口、skip/死支路、参数覆盖、关键对象逃逸、错 provider/reader/bin、未知标记均拒绝。第一棒将 build 假 CLI 测试明确固定 provider=claude，避免继承环境改变实际执行路径。模型服从任务范围仍需第二棒正式加载后新 A2/B 自然验收。

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 |
|---|---|---|
| ws1 | `packages/brain/src/lib/__tests__/existing-ops-build-source.test.js` | `激活后仅沿真实活跃 build 子进程认领活动、模板与假 CLI 输入` |
| ws1 | `packages/brain/src/lib/__tests__/existing-ops-build-source.test.js` | `缺省与0标记读取固定旧Git时保留完整输出逐字一致` |
| ws1 | `packages/brain/src/lib/__tests__/existing-ops-build-source.test.js` | `真实固定封套及第二棒新增 INTENT_PATH 普通参数均可证明` |
| ws1 | `packages/brain/src/lib/__tests__/existing-ops-build-source.test.js` | `现有活跃 publish 子进程在新协议中认领真实入口，不泛化其它活动或假GH` |

注册期递归检查所有 describe：只允许固定根 setup、惰性函数与纯数据初始化，拒绝 only、异步注册、立即调用、未知嵌套 hook 与测试进程控制。输入解析、规格 ID 校验、目录校验、HEAD 查询使用固定小函数 AST 封套，拒绝调用前的确定提前退出；不模拟文件系统或 Git 外部环境成功，真实回归继续负责运行结果。

固定 Git 测试使用本分支直接祖先，正式 CI fetch-depth: 0；无跨分支未合入对象依赖。可信旧2eb4工具应经真实静态 import 认领本棒新纯proof模块，不能候选工具自证；完整来源独审与正式CI后才合并。第二棒须等正式加载与新完整artifact，再激活marker。


## 正式 CI 发现的兼容合同

5bbda8 正式 brain-unit(1) 暴露当前 CLI 的 mainScopes 前置分支未被旧单范围来源证明识别；同例在正式 base 2eb4 也失败。保留当前真实 CLI，旧 YAML 夹具还原未配置 MAIN_SCOPES 的环境。仅精确缺省分支及正式 2eb4 完整 CLI canonical AST（包括参数构造、模块初始化与入口调用）通过时认定仍走单范围；任何层环境设置、前序副作用、条件/目标/参数改写都拒绝。

brain-unit(4) 将纯模板的 bin 兜底文本识别为执行。守卫只剥离固定无插值 ENVELOPES 的数据值，并绑定真实 Acorn 解析及既有布尔比较闭包；额外消费、AST 输出逃逸、真实进程别名调用继续报警，不整文件豁免。无 Acorn 启动夹具补齐本棒两个真实静态依赖，保留 import 成功、503 和零候选读取原断言。该夹具遗漏由本地精确复现发现，不冒称已在本次 PR CI 执行。

| Workstream | Test File | BEHAVIOR 覆盖 |
|---|---|---|
| ws1 | `packages/brain/src/lib/__tests__/existing-ops-source-impact.test.js` | `真实当前CLI只有mainScopes缺省才走单scope，false或空值仍进入main拒绝` |
| ws1 | `packages/brain/src/__tests__/claude-channel-retired.guard.test.js` | `真实无插值ENVELOPES仅供Acorn解析，原R3文本不是进程执行` |
| ws1 | `packages/brain/src/lib/__tests__/existing-ops-parser-startup.test.js` | `source extraction is explicitly unavailable and never reads or verifies candidate bytes` |

守卫实际读取 `existing-ops-build-source.js` 并验证固定解析与布尔 matcher 的 canonical AST，故按既有辅助关系登记该真实 verification owner；不增加装饰 import，也不扩大 collector 选择器。旧 34f 来源扫描仅该守卫未归属，失败记录保留，新基线 e9 与新增精确关系须重新完整验收。
