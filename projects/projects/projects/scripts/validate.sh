#!/bin/bash
set -Eeuo pipefail

# 基于脚本位置定位项目根目录（scripts/ 的上一级）
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

echo "🔍 Running validate..."
pnpm validate
echo "✅ Validate passed!"
