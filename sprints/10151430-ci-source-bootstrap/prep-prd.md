# CI 原生消费者来源协议自举

根任务：427d7e49-27c5-4612-b115-9214f03d47f9。GP-Anchor: none(infra)。

现有夜间 Vitest include 已选择 coding-workflow 测试，但消费者来源只登记毕业池，漏掉真实 runner 子进程和新增 snapshot provider。直接改旧协议会漂移旧固定快照；候选 PR 执行新 collector 又违反可信 base 合同。

本棒只安装额外协议识别能力，不导出激活标记。缺标记/0 保持旧绑定和关系；后续正式 PR 显式 export const EXISTING_OPS_RUNTIME_SELECTOR_SCHEMA = 1 后，才按真实 include-minus-exclude 选择 coding-workflow 的 JS/MJS 测试，解析语法并证明固定活跃测试→sandbox→run-once。未支持 TS/JSX 不在本次协议范围。provider 需可信 main checkout/祖先检查/直接 node 执行，以及必需 CI job 的直接 node --test；未知条件、cwd、shell 或容错封套拒绝。

验收：固定 9c Git 的旧输出与新 collector 输出逐项相同；真实 runner 正例和遮蔽/死分支/路径/argv 反例；独立用旧可信 base collector 核本 PR 全部新增文件归属。永久测试依赖完整 Git 历史，现有 brain-unit checkout fetch-depth: 0 保证。
