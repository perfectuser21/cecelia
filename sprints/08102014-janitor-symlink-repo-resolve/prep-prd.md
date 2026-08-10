# Bug PrepPRD：janitor.sh 软链调用下 CECELIA_REPO 解析失效，步骤8静默跳过

## 症状
生产真跑验收（2026-08-10 20:10）：`~/bin/janitor.sh --mode daily` 输出
`[8/10] Git 孤儿分支... ✗ 跳过（git 仓库不存在）`。步骤8从新家上线第一天起在生产就没跑过。

## 根因（已实证，非假设）
`scripts/ops/janitor.sh:39`：`CECELIA_REPO="$(cd "$(dirname "$0")/../.." && pwd)"`。
cron/宿主经 `~/bin/janitor.sh` 软链调用时 `$0=/Users/administrator/bin/janitor.sh`，
反推出 `/Users/administrator`（无 .git）→ 步骤8跳过。
CI 测试用真实路径调用，测不到"软链调用"这个真实接缝——正是 janitor 归位任务要杀的
"换个调用方式就静默失效"病在自己身上复发。

## 关联上下文
- Journey：工厂 · F4 故障自愈（91c17939）
- 前序：PR#4769（janitor 归位）、决策 c14a3e6f
- 同类病史：branch-gc.sh 虚构依赖（同为"引用成立性无人校验"族）

## 修法
1. `scripts/ops/janitor.sh:39` 前加 `SCRIPT_PATH="$(readlink -f "$0" 2>/dev/null || echo "$0")"`,
   CECELIA_REPO 改从 `$SCRIPT_PATH` 反推（macOS 15 readlink 支持 -f，`|| echo "$0"` 兜底直调场景）
2. 步骤8"git 仓库不存在"跳过分支（:605 附近）计入 FAILED_STEPS——环境断裂不许静默 ✗

## Regression Test 计划
`scripts/ops/__tests__/janitor/janitor_symlink_repo_resolve.test.sh`（草稿已备）：
- 用例1：搭 tmp 假仓库+软链，以软链为 $0 执行脚本头部提取的解析逻辑 → 断言解析到真实仓库根
- 用例2：真实路径直调 → 断言同样正确（防修复只顾软链坏了直调）
- 用例3：grep 断言步骤8"仓库不存在"分支含 FAILED_STEPS 记账
测试提取脚本真实代码行执行（sed 提取 SCRIPT_PATH/CECELIA_REPO 赋值行），不测复制品。

## 守卫说明（哨兵死规矩）
接缝=宿主软链调用方式（环境接缝）。CI 内软链复现测试可覆盖此接缝（软链在 CI 沙箱可真实构造，
不依赖生产 env），故 CI regression test 即为对种类守卫；修复验证时在生产宿主真跑一次 daily 作
proven-to-fire 补充证据（步骤8从"✗ 跳过"变为真执行）。

## 验收标准
- [ ] failing test 先 commit（commit-1），当前实现下真实报红
- [ ] 修复代码让 test 变绿（commit-2）
- [ ] 生产宿主经 ~/bin/janitor.sh 软链真跑：步骤8不再"✗ 跳过"
- [ ] CI 全绿
