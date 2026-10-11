#!/usr/bin/env bash
# scripts/lib/url-encode.sh — 纯 bash URL 百分号编码（RFC 3986 unreserved 之外全部编码）。
#
# 为什么不用 jq / python3：Brain 镜像（alpine）里两者都没有。旧实现两者都缺时原样返回，
# 中文+空格直接拼进 Bark URL 被 curl 拒收，部署告警一律"推送失败"（e2fc7076）。
# 本函数只依赖 bash 内建，按 C locale 逐字节编码，UTF-8 多字节字符得到标准 %XX 序列。

# _url_encode <str>：输出编码后的字符串（无换行）
_url_encode() {
  local LC_ALL=C
  local str="$1" out="" ch hex n i
  for (( i = 0; i < ${#str}; i++ )); do
    ch="${str:i:1}"
    case "$ch" in
      [a-zA-Z0-9.~_-]) out+="$ch" ;;
      *)
        printf -v n '%d' "'$ch"
        (( n < 0 )) && n=$(( n + 256 ))   # bash 3.2 对高位字节做符号扩展
        printf -v hex '%%%02X' "$n"
        out+="$hex" ;;
    esac
  done
  printf '%s' "$out"
}
