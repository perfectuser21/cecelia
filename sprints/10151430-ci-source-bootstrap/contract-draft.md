# Contract Draft — 固定 Git 原生来源协议自举

任务：427d7e49-27c5-4612-b115-9214f03d47f9。GP-Anchor: none(infra)。
被测对象：packages/brain/src/lib/existing-ops-source.js 与 existing-ops-runtime-source.js。
归属：已有 F3 回归消费者；不改变能力树，不授予完整 Workflow 执行权限。

## 行为合同

| 行为 | 可观察验收 | 永久测试 |
|---|---|---|
| 缺省/0 协议保持旧来源 | 固定 9c 的完整输出、bindings、input_relations 不变 | existing-ops-source.test.js；existing-ops-runtime-source.test.js |
| 显式 export const 1 才扩展 | 私有/注释不激活；动态、可变或未知标记拒绝 | existing-ops-runtime-source.test.js |
| 原生测试有真实选择器 | coding-workflow JS/MJS 需匹配现行 include-minus-exclude 且可解析；排除文件不认领入口 | existing-ops-source.test.js |
| 活跃测试真实运行入口 | 活跃 it → 具名 sandbox helper → 固定 AST spawn(process.execPath,[RUN_ONCE])，登记真实入口 | existing-ops-source.test.js |
| 错误路径失败关闭 | skip、死分支、遮蔽、对象逃逸、动态构造、路径/argv 漂移均拒绝，不保留部分成功绑定 | existing-ops-source.test.js |
| provider 有真实执行封套 | main checkout/祖先验证/直接 node 与 required node --test；禁用 job、cwd、shell、容错漂移拒绝 | existing-ops-source.test.js |
| 原服务启动兼容 | 无 Acorn 仍可读身份；实际来源提取明确报不可用，不读候选字节 | existing-ops-parser-startup.test.js |

以上测试路径均在 packages/brain/src/lib/__tests__/。当前合同第一棒不导出激活标记；后续正式 PR 才激活。

## Test Contract

以下 BEHAVIOR 使用现有永久测试的完整 `it()` 名称，测试文件均为仓库根目录相对路径。

| Workstream | Test File | BEHAVIOR 覆盖 |
|---|---|---|
| ws1 | `packages/brain/src/lib/__tests__/existing-ops-runtime-source.test.js` | `缺省、私有或注释标记不启用，合法 export const 1 才启用` |
| ws1 | `packages/brain/src/lib/__tests__/existing-ops-runtime-source.test.js` | `动态、可变、未知与重复声明不猜为可执行来源` |
| ws1 | `packages/brain/src/lib/__tests__/existing-ops-source.test.js` | `固定 9c 真实 nightly include 选中 runner 测试，活跃 it 经原生子进程消费真实入口` |
| ws1 | `packages/brain/src/lib/__tests__/existing-ops-source.test.js` | `未激活与注释 marker 逐项保留旧 bindings / input_relations，未知值拒绝` |
| ws1 | `packages/brain/src/lib/__tests__/existing-ops-source.test.js` | `真实 exclude 不选择 runner test 时不凭文件存在认领 run-once` |
| ws1 | `packages/brain/src/lib/__tests__/existing-ops-source.test.js` | `只接受活跃 it 的真实具名 helper 调用，不接受 skip、死支路、假字符串或遮蔽` |
| ws1 | `packages/brain/src/lib/__tests__/existing-ops-source.test.js` | `固定 sandbox AST 拒绝参数漂移、路径逃逸、赋值和绑定遮蔽` |
| ws1 | `packages/brain/src/lib/__tests__/existing-ops-source.test.js` | `真实 provider 工作流及 required CI 测试逐项登记，注释或条件假调用拒绝` |
| ws1 | `packages/brain/src/lib/__tests__/existing-ops-parser-startup.test.js` | `imports source identity for normal service startup without loading Acorn` |
| ws1 | `packages/brain/src/lib/__tests__/existing-ops-parser-startup.test.js` | `source extraction is explicitly unavailable and never reads or verifies candidate bytes` |
| ws1 | `packages/brain/src/lib/__tests__/existing-ops-parser-startup.test.js` | `invalid admission remains invalid before attempting parser resolution` |

## 验收命令与已有证据

```bash
cd packages/brain
npx vitest run src/lib/__tests__/existing-ops-runtime-source.test.js src/lib/__tests__/existing-ops-source.test.js src/lib/__tests__/existing-ops-source-impact.test.js src/lib/__tests__/existing-ops-parser-startup.test.js --maxWorkers=1 --minWorkers=1
```

红提交 95bcdba9d 实跑 5 failed / 14 passed；实现及错误路径修复到 a68b636c 后 50 passed。
独立旧 9c 可信 collector 使用正式 9c artifact 完整双 scope scratch 两侧 verified、gaps=[]、联合 unclaimed=[]。
固定历史测试要求完整 Git 历史，正式 brain-unit checkout 使用 fetch-depth: 0。
本合同文档补齐不等于 GitHub 官方 CI 已通过；实际 PR 门禁仍须成功后正常合并。
