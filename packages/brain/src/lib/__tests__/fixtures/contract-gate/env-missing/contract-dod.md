# Env-Missing Fixture — 引用 evaluator 容器不可用的二进制

> 永久回归样本：脚本引用 docker / ffprobe（环境能力清单标记为不可用），gate 应命中 env_missing。

## BEHAVIOR 条目

- [ ] [BEHAVIOR] 视频转码后校验流（依赖容器内不存在的工具）
  Test: manual:bash -c 'docker run --rm myimg ffprobe -show_streams /tmp/out.mp4 | jq -e ".streams | length > 0"'
