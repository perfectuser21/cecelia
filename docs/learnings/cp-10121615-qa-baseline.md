# local QA 的历史基线不得依赖可写 Git 元数据

真实 Z0 QA 的沙箱将 gitdir 设为只读，而旧 evaluate-local 指导用 git worktree add 起基线，操作本身就会写 Git 元数据。场景已允许从固定提交提取独享副本，故修复提示词，不放宽 QA 合同或权限。

基线只能取 01/02 合同指定的固定 SHA，或场景明确指定、解析一次并记录完整 SHA 的本机 ref；缺少起点不能用移动的 origin/main 猜测。archive/show 只解决提取能力，不证明历史行为已经通过。副本也禁止读取 03/04，不拿测试套件替代独立黑盒验收。

回归首红 514e86f54：1 failed / 22 passed；修复后 evaluate 23/23 通过。真实 native QA 在一次性 linked worktree 中验证固定提交 archive/show 提取、旧/新用户 CLI 黑盒输出不同，HEAD 与已跟踪文件不变。原始证据保留在 ~/.codex-team1/artifacts/cw-qa-baseline-ecaa6e07；不据此改写 Z0 历史 Q6 或旧失败报告。

权限回归口径：本补丁不改 sandbox。旧 Codex 适配真实 QA 探针 cw-native-qa-probe2 已证 commit 返回 128；本轮初始会话未产生 commit 命令事件，后续探针仅有拒绝 stderr 文件而无原生 command_execution，不能把自述计作本轮提交拒绝证据。新提取与黑盒对比有完整原生命令完成事件，独立外层核查 HEAD/tracked 保持不变。
