# 原生 shell 包装必须静态解码且全文匹配

Z0 387cb817 的 verify 真实运行了命令，但 Codex command_execution 展示 `/opt/homebrew/bin/bash -lc <quoted>`，证据保留内层脚本；直接字符串包含无法处理 shell 引号和反斜杠。原生记录同时暴露原包含判据能把 echo、注释中的文本冒认为执行。

修复约束：只静态解一层已知 shell 的单个引用 argv，拒动态展开、额外参数及外层控制符，不 eval、不递归解包；原生证据全文匹配，不从内层复合命令切片。命令、输出、exit_code 必须来自同一完成事件，未知退出码不作证。非零退出码可证明真实负例，不能伪装为零。

验证：真实脱敏 fixture 首红提交 9acd0602d（21 failed/8 passed）；修复后复盘原始 E-1 至 E-5 均有执行依据，但 E-4/E-5 原始 FAIL 判分保持，不回写旧任务或报告。
