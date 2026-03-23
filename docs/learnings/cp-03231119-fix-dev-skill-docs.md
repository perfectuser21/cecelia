# Learning: fix(dev-skill): /dev skill .md 文档 P0/P1/P2 bug 修复

## 根本原因

skill 文档（SKILL.md、steps/00~04.md）与实现之间长期存在漂移：
- macOS 的 `sed -i` 不接受无扩展名写法，需 `sed -i ''`；Linux 不接受有引号写法。两者不兼容，bash 脚本应用跨平台写法
- SKILL.md 残留"有 develop 用 develop"描述，但此仓库始终只有 main，导致新 agent 上下文错误
- seal key 描述（STEP_seal vs step_1_spec_seal）与代码实现不符
- 章节编号（3.1.4、4.3、4.5、4.6）因中间步骤被删除后未重新排号，造成混乱
- `grep -c` 在多文件时输出 `文件名:数字` 格式，直接赋给变量导致计算错误

## 下次预防

- [ ] 修改 verify-step.sh 等 bash 文件时，同步更新 skill 文档描述
- [ ] 涉及 macOS 兼容的 sed -i 必须用跨平台模式：`sed -i '' ... 2>/dev/null || sed -i ...`
- [ ] 删除章节后必须重新排号，不留编号空洞
- [ ] 多文件场景下 grep -c 改为 `grep -rh pattern files | wc -l | tr -d ' '`
- [ ] 涉及"目标分支"的文档统一写 main，去掉 develop 分支特判描述
