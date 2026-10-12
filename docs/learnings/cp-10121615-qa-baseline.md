# local QA 的历史基线不得依赖可写 Git 元数据

真实 Z0 QA 的沙箱将 gitdir 设为只读，而旧 evaluate-local 指导用 git worktree add 起基线，操作本身就会写 Git 元数据。场景已允许从固定提交提取独享副本，故修复提示词，不放宽 QA 合同或权限。

基线只能取 01/02 合同指定的固定 SHA，或场景明确指定、解析一次并记录完整 SHA 的本机 ref；缺少起点不能用移动的 origin/main 猜测。archive/show 只解决提取能力，不证明历史行为已经通过。副本也禁止读取 03/04，不拿测试套件替代独立黑盒验收。

回归首红 514e86f54：1 failed / 22 passed；修复后 evaluate 23/23 通过。真实 native QA 在一次性 linked worktree 中验证固定提交 archive/show 提取、旧/新用户 CLI 黑盒输出不同，HEAD 与已跟踪文件不变。原始证据保留在 ~/.codex-team1/artifacts/cw-qa-baseline-ecaa6e07；不据此改写 Z0 历史 Q6 或旧失败报告。

权限回归口径：本补丁不改 sandbox。旧 Codex 适配真实 QA 探针 cw-native-qa-probe2 已证 commit 返回 128；本轮初始会话未产生 commit 命令事件，后续探针仅有拒绝 stderr 文件而无原生 command_execution，不能把自述计作本轮提交拒绝证据。新提取与黑盒对比有完整原生命令完成事件，独立外层核查 HEAD/tracked 保持不变。

## 记录落盘也适配目标仓

下一真实 QA 已完成基线黑盒操作并有效报告 CANNOT_VERIFY，但目标仓 core.ignorecase=true 与 *REPORT*.md 使普通 git add 拒绝报告，卡在进入 commander 前。首红 fe989657c 用真实临时 Git 的完整 QA 门复现 qa_report_add_failed。仅当前任务/sprint/轮次严格限定记录用 literal-pathspecs + add -f；全部路径预验，不跟随链接，不允许空记录或已有暂存夹带。smoke 分开普通 add。既有 pr-branch/plan 统一 sprints/<stamp>-cw-<task8> 命名，验证沿用合同。

验证：完整 QA 门48/48绿，新 CANNOT_VERIFY 忽略报告和 smoke 不强制添加3/3定向绿，路径边界真实Git14/14绿。judgeRound 重试用例增加忽略报告/裁决规则，1/1绿。保留旧冻结工作树与错误，不手填 passed。

CI 夹具修正：新 qa-records 临时仓未设置提交身份，本机 Git 自动探测掩盖问题，Linux CI 初始化14例全部失败。隔离全局/系统配置并启用 user.useConfigOnly 重现14红；修复为临时仓局部设置 name/email/useConfigOnly，不改任何全局配置。其余本 PR 新用例复用 sandbox.mjs，seed 原有本地身份与 runner 显式 RUNNER_ID 保持。产品候选 c7bc9fe29 完全未改。
