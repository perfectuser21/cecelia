#!/usr/bin/env bash
# 薄包装：skill 清单生成器的本体在 packages/brain/src/lib/skill-manifest.sh
# （Brain 镜像只拷 packages/brain/src，job 要在运行时读到它）。用法与本体一致。
exec bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../packages/brain/src/lib/skill-manifest.sh" "$@"
