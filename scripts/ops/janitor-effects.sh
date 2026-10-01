#!/usr/bin/env bash
# 观察模式的执行现场挡板；调用方必须在写动作之前 return/continue。
janitor_observe_only() {
  [ "${DRY_RUN:-false}" = true ] || return 1
  printf '[DRY-RUN] %s\n' "$*"
  return 0
}
