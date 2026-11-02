# 第 1 轮规格回应

### R-1
处理: 采纳
说明: `lib/claude.mjs` 当前 `renderPrompt` 按 `Object.entries(vars).reduce(...replaceAll...)` 顺序替换，先插入的旧规则若含后续变量名，确会被二次展开。S-1 已将该文件列为修改范围，要求只扫描原模板占位符，并以含字面量 `{{SPEC_PATH}}` 的固定 Git 原文核对 spec、review、revise 三阶段实际提示；S-5 指定对应回归断言。Q-1 增加当前产品可见的固定原文中字面量与 02 对该规则的引用、处理对照及当前 Git 来源检查。实际模型提示字节和发布前现场仍由当时 verify 与独立 judge 凭原生证据核验，正式 QA 不读取 03/04，也不把当前现场当作过去现场。
