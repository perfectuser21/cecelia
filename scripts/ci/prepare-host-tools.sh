#!/usr/bin/env bash
set -euo pipefail

# 按真实检查入口声明宿主依赖。scripts 的 hook/worktree 和 mirror 回归需要 jq；
# Brain 的 shell fixture 使用 bash，zsh 只出现在进程名样本，XML 工具没有消费者。
if (($# != 1)); then
  printf '%s\n' '用法：prepare-host-tools.sh component' >&2
  exit 1
fi
case "$1" in
  scripts) tools=(jq); packages=(jq) ;;
  brain-unit|brain-integration|ops|image|dashboard) tools=(); packages=() ;;
  *) printf '未知 CI 组件：%s\n' "$1" >&2; exit 1 ;;
esac

# 版本探针同时检查可执行文件能否实际运行，避免仅存在于PATH却已损坏。
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
