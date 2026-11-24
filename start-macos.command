#!/bin/bash
cd "$(dirname "$0")" || exit 1
export PATH="$HOME/.local/bin:$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  echo "请先安装 Node.js 22 LTS，然后重新双击启动。https://nodejs.org/"
  read -r -p "按回车关闭…"
  exit 1
fi
node editor-integration/scripts/start-local.mjs
result=$?
if [ "$result" -ne 0 ]; then read -r -p "启动失败，按回车关闭…"; fi
exit "$result"
