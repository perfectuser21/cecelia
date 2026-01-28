#!/bin/bash
# Credential Guard Hook
# 拦截写入代码时包含真实凭据的操作

# 只检查代码文件，跳过 ~/.credentials/
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.command // ""')

# 跳过凭据目录本身
if [[ "$FILE_PATH" == *".credentials"* ]]; then
    exit 0
fi

# 跳过非代码目录
if [[ "$FILE_PATH" == "/tmp"* ]] || [[ "$FILE_PATH" == *".log"* ]]; then
    exit 0
fi

# 获取要写入的内容
CONTENT=$(echo "$INPUT" | jq -r '.tool_input.content // .tool_input.new_string // ""')

# 如果没有内容，放行
if [ -z "$CONTENT" ]; then
    exit 0
fi

# 检测真实凭据模式
PATTERNS=(
    'ntn_[a-zA-Z0-9]{20,}'                    # Notion API Key
    'github_pat_[a-zA-Z0-9_]{30,}'            # GitHub PAT
    'sk-proj-[a-zA-Z0-9_-]{40,}'              # OpenAI API Key
    'eyJ[a-zA-Z0-9_-]{50,}\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+' # JWT tokens
    'dop_v1_[a-zA-Z0-9]{50,}'                 # DigitalOcean
    'cli_[a-zA-Z0-9]{16,}'                    # Feishu App ID
)

for pattern in "${PATTERNS[@]}"; do
    if echo "$CONTENT" | grep -qE "$pattern"; then
        # 检查是否是占位符
        if echo "$CONTENT" | grep -qE "(YOUR_|example|placeholder|xxx)"; then
            continue
        fi

        echo "CREDENTIAL_DETECTED"
        cat << 'EOF'

[CREDENTIAL GUARD] 检测到真实凭据！

禁止将 API Key/Token 写入代码文件。

正确做法：
1. 凭据存储：~/.credentials/<service>.env
2. 代码中用：process.env.XXX 或占位符
3. .env.example 只放 YOUR_XXX_KEY 格式

如需保存新凭据，使用 /credentials skill。
EOF
        exit 2
    fi
done

exit 0
