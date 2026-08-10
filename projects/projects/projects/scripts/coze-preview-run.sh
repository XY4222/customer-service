#!/usr/bin/env bash
set -euo pipefail

# 基于脚本位置定位项目根目录（scripts/ 的上一级）
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

# 从 .preview 读取 expose_port，读取不到 fallback 5000
EXPOSE_PORT=$(awk -F '[ =]+' '/^expose_port/ {gsub(/[^0-9]/, "", $2); print $2; exit}' .preview 2>/dev/null || echo 5000)

export HOSTNAME=0.0.0.0
export PORT="$EXPOSE_PORT"

# 清理残留（绝不碰 9000）
fuser -k "${EXPOSE_PORT}/tcp" 2>/dev/null || true
sleep 1

echo "Starting Next.js dev server on 0.0.0.0:${EXPOSE_PORT}..."
exec pnpm tsx watch src/server.ts
