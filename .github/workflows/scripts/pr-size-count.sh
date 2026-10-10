#!/usr/bin/env bash
# pr-size-count.sh <base> <head> — 输出 "<新增行> <删除行>"，供 ci.yml pr-size-check 用。
# sprints/ 是 coding workflow 的过程记录（规格、QA 报告、裁判报告），不是待评审代码：
# GAN 轮次无上限（invariant 02d8e749），记录随轮次增长，计入会把多轮 PR 拦在 3000 行硬门槛上（#6232）。
set -euo pipefail
BASE="$1"
HEAD="$2"
git diff --numstat "$BASE"..."$HEAD" -- . ':(exclude)sprints/' \
  | awk '$1 != "-" {a += $1; d += $2} END {print a + 0, d + 0}'
