#!/data/data/com.termux/files/usr/bin/bash
# link-dev-deps.sh —— 建好 headless 冒烟测试需要的 node_modules 软链
#
# pi 加载扩展时用的是它自己的 jiti + virtualModules，**不需要**这些软链；
# 只有 `node tools/smoke-test.mjs`（脱离 pi 跑一遍模块图）才需要能解析
# jiti 与 @earendil-works/{pi-coding-agent,pi-tui,pi-ai}。
#
# 用法：
#   bash tools/link-dev-deps.sh                 # 自动探测 pi 安装位置
#   PI_SDK_DIR=/path/to/@earendil-works bash tools/link-dev-deps.sh
#
# 软链落在 node_modules/ 下（已在 .gitignore 里），不会进仓库。

set -u

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

pick_sdk_dir() {
	if [ -n "${PI_SDK_DIR:-}" ]; then echo "$PI_SDK_DIR"; return; fi
	# 1) 从 pi 可执行文件反推（follow symlink）
	local pi_bin
	pi_bin="$(command -v pi 2>/dev/null || true)"
	if [ -n "$pi_bin" ]; then
		local resolved
		resolved="$(readlink -f "$pi_bin" 2>/dev/null || true)"
		# .../@earendil-works/pi-coding-agent/dist/bundle/cli.js → .../@earendil-works
		local dir="$resolved"
		while [ -n "$dir" ] && [ "$dir" != "/" ]; do
			[ "$(basename "$dir")" = "@earendil-works" ] && { echo "$dir"; return; }
			dir="$(dirname "$dir")"
		done
	fi
	# 2) 常见全局路径
	for candidate in \
		"$PREFIX/lib/node_modules/@earendil-works" \
		"$(npm root -g 2>/dev/null)/@earendil-works"; do
		[ -d "$candidate" ] && { echo "$candidate"; return; }
	done
}

SDK_DIR="$(pick_sdk_dir)"
if [ -z "$SDK_DIR" ] || [ ! -d "$SDK_DIR" ]; then
	echo "找不到 @earendil-works 目录；用 PI_SDK_DIR=... 明确指定" >&2
	exit 1
fi

mkdir -p node_modules/@earendil-works

link() {
	local target="$1" dest="$2"
	[ -e "$target" ] || { echo "   - 跳过（不存在）: $target"; return; }
	[ -e "$dest" ] && { echo "   = 已存在: $dest"; return; }
	ln -s "$target" "$dest"
	echo "   + $dest -> $target"
}

echo "SDK: $SDK_DIR"
# 顶层直接就有（npm root -g 的情况）
for pkg in pi-coding-agent pi-tui pi-ai; do
	link "$SDK_DIR/$pkg" "node_modules/@earendil-works/$pkg"
done
# 常见情况：pi-tui / pi-ai / jiti 都在 pi-coding-agent 自己的 node_modules 下
for pkg in pi-tui pi-ai; do
	link "$SDK_DIR/pi-coding-agent/node_modules/@earendil-works/$pkg" "node_modules/@earendil-works/$pkg"
done
link "$SDK_DIR/pi-coding-agent/node_modules/jiti" "node_modules/jiti"

echo
echo "完成。跑冒烟： node tools/smoke-test.mjs"
