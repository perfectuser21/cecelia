#!/bin/bash
set -euo pipefail

# PM2 进程管理 + 日志轮转安装脚本
# 用途：一键配置 Brain 进程管理，崩溃自动重启，日志自动轮转

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRAIN_DIR="$(dirname "$SCRIPT_DIR")"

echo "=== Cecelia Brain PM2 配置 ==="

# 1. 安装 pm2（如果没有）
if ! command -v pm2 >/dev/null 2>&1; then
    echo "正在安装 PM2..."
    npm install -g pm2
else
    echo "PM2 已安装: $(pm2 --version)"
fi

# 2. 安装日志轮转模块
echo "配置 pm2-logrotate..."
pm2 install pm2-logrotate

# 配置日志轮转参数
pm2 set pm2-logrotate:max_size 50M      # 单文件最大 50MB
pm2 set pm2-logrotate:retain 5           # 保留最近 5 个轮转文件
pm2 set pm2-logrotate:compress true      # 压缩旧日志
pm2 set pm2-logrotate:dateFormat YYYY-MM-DD_HH-mm-ss
pm2 set pm2-logrotate:workerInterval 30  # 每 30 秒检查一次
pm2 set pm2-logrotate:rotateInterval '0 0 * * *'  # 每天午夜强制轮转

# 3. 启动 Brain
echo "启动 Brain 进程..."
cd "$BRAIN_DIR"
pm2 start ecosystem.config.cjs

# 4. 保存进程列表（开机自启）
pm2 save

echo ""
echo "=== 配置完成 ==="
echo "Brain 已通过 PM2 管理，崩溃自动重启，日志自动轮转"
echo ""
echo "常用命令："
echo "  pm2 status          - 查看进程状态"
echo "  pm2 logs cecelia-brain - 查看实时日志"
echo "  pm2 restart cecelia-brain - 重启 Brain"
echo "  pm2 stop cecelia-brain    - 停止 Brain"
echo "  pm2 monit           - 打开监控面板"
