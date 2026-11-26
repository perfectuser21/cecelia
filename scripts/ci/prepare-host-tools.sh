#!/usr/bin/env bash
set -euo pipefail

# 版本探针同时检查可执行文件能否实际运行，避免仅存在于PATH却已损坏。
tools=(rg jq zsh xmllint)
packages=(ripgrep jq zsh libxml2-utils)
missing_packages=()
for index in "${!tools[@]}"; do
  if ! "${tools[$index]}" --version >/dev/null 2>&1; then
    missing_packages+=("${packages[$index]}")
  fi
done

if ((${#missing_packages[@]} == 0)); then
  printf '%s\n' '测试工具已齐备，无需APT安装。'
  exit 0
fi

sudo apt-get update -qq
sudo apt-get install -y --no-install-recommends "${missing_packages[@]}"

for tool in "${tools[@]}"; do
  if ! "$tool" --version >/dev/null 2>&1; then
    printf '安装后测试工具仍不可用：%s\n' "$tool" >&2
    exit 1
  fi
done
