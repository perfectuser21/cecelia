#!/usr/bin/env bash
# skill-manifest.sh — 对一个 skills 目录逐个 skill 算稳定内容哈希，输出一行 JSON。
#
# 用法：skill-manifest.sh [DIR]       DIR 默认 @home/.claude/skills
#   DIR 支持 @home/ 前缀（按「本脚本所在机器」的 $HOME 展开；调用方经 ssh 传参时不要写 ~，
#   否则会被调用方 shell 先展成它自己的家目录）。也接受 ~/ 前缀。
#
# 输出（一行）：
#   {"version":1,"dir":…,"host":…,"count":N,"skills":{name:sha256…},"broken":[name…],"tree_hash":sha256}
# 目录不存在：{"version":1,"error":"dir_missing","dir":…} 退出码 3（与「目录存在但为空」区分）。
#
# 哈希口径（JS 侧 lib/skill-manifest.js 的 treeHashOf/verifyTreeHash 必须与此一致）：
#   - skill = DIR 下非隐藏的目录，或指向目录的符号链接（跟随，按内容算）；悬空符号链接进 broken
#   - skill 哈希 = sha256( 按相对路径字节序排序的 "相对路径<TAB>文件sha256\n" )
#     路径分量含 .git / .DS_Store / node_modules / __pycache__ 的项不参与（后者是跑场机上 python skill 运行时自己生成的字节码，
#     不排除会让每次执行后都出永久假漂移——09-25 真机 dry-run 在 M4 的 skill-creator 上实测到）；mtime、权限位不参与
#   - tree_hash = sha256( 全部有内容 skill 的 "name<TAB>skill哈希\n" 行整体字节序排序 )
#     只代表「可用内容」；悬空项（无内容）不进 tree_hash，只在 broken 里单列，
#     否则真身自己的悬空链接（MMV 实测 29 个）会让任何目标永远对不齐
#
# 为什么跟随符号链接：MMV 的 ~/.claude/skills 顶层几乎全是指向 zenithjoy-skills 的符号链接。
# 09-25 实测 cron 用 rsync -a（无 -L）把链接原样拷到跑场机，M1 上 133/133 悬空——条目数对得上、
# 内容为零。按内容哈希 + broken 单列，才看得见这种「数量对、内容空」的假对齐。
#
# 依赖：bash 3.2+（macOS 自带）、find、sort、sha256sum 或 shasum。无 node/jq。只读，不写任何文件。
set -u
export LC_ALL=C
TAB="$(printf '\t')"

dir="${1:-@home/.claude/skills}"
# shellcheck disable=SC2088  # 有意匹配字面 ~/（调用方可能没展开）
case "$dir" in
  @home)   dir="$HOME" ;;
  @home/*) dir="$HOME/${dir#@home/}" ;;
  "~")     dir="$HOME" ;;
  "~/"*)   dir="$HOME/${dir#\~/}" ;;
esac

json_str() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }

if [ ! -d "$dir" ]; then
  printf '{"version":1,"error":"dir_missing","dir":"%s"}\n' "$(json_str "$dir")"
  exit 3
fi

if command -v sha256sum >/dev/null 2>&1; then
  sha_file() { sha256sum < "$1" | { read -r h _; printf '%s' "$h"; }; }
  sha_stdin() { sha256sum | { read -r h _; printf '%s' "$h"; }; }
elif command -v shasum >/dev/null 2>&1; then
  sha_file() { shasum -a 256 < "$1" | { read -r h _; printf '%s' "$h"; }; }
  sha_stdin() { shasum -a 256 | { read -r h _; printf '%s' "$h"; }; }
else
  printf '{"version":1,"error":"no_sha256_tool","dir":"%s"}\n' "$(json_str "$dir")"
  exit 4
fi

skill_hash() {
  ( cd "$1" 2>/dev/null || exit 1
    find -L . \( -name .git -o -name .DS_Store -o -name node_modules -o -name __pycache__ \) -prune -o -type f -print 2>/dev/null \
      | sort \
      | while IFS= read -r f; do
          printf '%s\t%s\n' "${f#./}" "$(sha_file "$f")"
        done \
      | sha_stdin )
}

lines=""    # name<TAB>hash（仅有内容的 skill），用于 tree_hash
skills_json=""
broken_json=""
count=0

for e in "$dir"/*; do
  [ -e "$e" ] || [ -L "$e" ] || continue
  name="${e##*/}"
  if [ -L "$e" ] && [ ! -e "$e" ]; then
    broken_json="${broken_json:+$broken_json,}\"$(json_str "$name")\""
    continue
  fi
  [ -d "$e" ] || continue
  h="$(skill_hash "$e")"
  lines="${lines}${name}${TAB}${h}
"
  skills_json="${skills_json:+$skills_json,}\"$(json_str "$name")\":\"${h}\""
  count=$((count + 1))
done

tree_hash="$(printf '%s' "$lines" | sort | sha_stdin)"
host="$(hostname -s 2>/dev/null || hostname 2>/dev/null || echo unknown)"

printf '{"version":1,"dir":"%s","host":"%s","count":%d,"skills":{%s},"broken":[%s],"tree_hash":"%s"}\n' \
  "$(json_str "$dir")" "$(json_str "$host")" "$count" "$skills_json" "$broken_json" "$tree_hash"
