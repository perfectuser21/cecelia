## Brain {VERSION} — worker 池 ssh 套壳 $ 转义(并行血管 P1 补丁3)

- wrap() 补 `$`→`\$` 转义:双引号 ssh 参数里 `$(cat promptFile)` 被容器 shell 先求值成空串,发射命令落地成 `claude-launch.sh ""`(金丝雀案 worker 空转);修后 $(…) 活到宿主端求值
