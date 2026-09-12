#!/data/data/com.termux/files/usr/bin/bash
# sync-upstream.sh —— 把上游插件的"要合并的那部分"抽到 vendor/，并和已 vendor 的版本比对
#
# 为什么需要它：alps-pi 8.8k 行没法复用、只能 vendor；上游还在活跃开发（0.3.x），
# 所以必须做到「随时能看清上游改了什么、能一键重抽」，否则 fork 很快就会烂在手里。
#
# 用法：
#   bash tools/sync-upstream.sh --list              # 列上游装了什么版本、vendor 里有什么
#   bash tools/sync-upstream.sh --check             # 逐文件比对上游 vs vendor（不改任何文件）
#   bash tools/sync-upstream.sh --check alps-pi     # 只比一个
#   bash tools/sync-upstream.sh --update alps-pi    # 抽取到 vendor/alps-pi@<版本>/
#
# 注意：
#   - 抽取源固定是 pi 的 npm 安装目录（默认 ~/.pi/agent/npm/node_modules，可用 PI_NPM_DIR 覆盖）。
#   - 不删任何目录（本机权限策略禁 rm 带 flag）：同版本重复抽取是「覆盖合并」，
#     升级请走新版本号目录，然后改 extensions/pi-tui-suite.ts 里的 import。
#   - vendor/ 约定只读：本地改动放 src/，需要改 vendor 代码时写进 src/patches/。

set -u

NPM_DIR="${PI_NPM_DIR:-$HOME/.pi/agent/npm/node_modules}"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR_DIR="$REPO_DIR/vendor"

PKGS=(alps-pi pi-open-tui pi-rounded-tools)

# 每个包「要合并进套件」的文件清单（相对包根）；只有列表里的东西会被抽取/比对。
files_for() {
	case "$1" in
		alps-pi)
			# 全量：index.ts 是入口，src/ 内部 import 全是相对路径，原样可用
			printf '%s\n' index.ts src package.json README.md LICENSE themes
			;;
		pi-open-tui)
			# 只要 header 用到的那两个文件（其余 2,000+ 行是死代码）
			printf '%s\n' extensions/open-tui/header.ts extensions/open-tui/utils.ts package.json LICENSE
			;;
		pi-rounded-tools)
			printf '%s\n' extensions/rounded-tools.ts package.json LICENSE
			;;
		*)
			return 1
			;;
	esac
}

upstream_version() {
	python3 - "$NPM_DIR/$1/package.json" <<'EOF' 2>/dev/null
import json, sys
print(json.load(open(sys.argv[1]))["version"])
EOF
}

vendored_dirs() {
	ls -d "$VENDOR_DIR/$1@"* 2>/dev/null | while read -r d; do basename "$d"; done
}

uses() {
	echo "用法: $0 --list | --check [包名] | --update <包名>"
	echo "包名: ${PKGS[*]}"
}

case "${1:---help}" in
	--list)
		printf '%-18s %-10s %s\n' 包 上游版本 "vendor 里已有"
		for pkg in "${PKGS[@]}"; do
			ver="$(upstream_version "$pkg")"
			[ -z "$ver" ] && ver="(未安装)"
			printf '%-18s %-10s %s\n' "$pkg" "$ver" "$(vendored_dirs "$pkg" | paste -sd, -)"
		done
		;;

	--check)
		targets=("${@:2}")
		[ "${#targets[@]}" -eq 0 ] && targets=("${PKGS[@]}")
		for pkg in "${targets[@]}"; do
			src="$NPM_DIR/$pkg"
			ver="$(upstream_version "$pkg")"
			[ -z "$ver" ] && { echo "!! $pkg 未安装于 $NPM_DIR"; continue; }
			dest="$VENDOR_DIR/$pkg@$ver"
			echo "== $pkg@$ver"
			if [ ! -d "$dest" ]; then
				echo "   vendor 里没有 $pkg@$ver（先跑 --update $pkg）"
				continue
			fi
			while read -r rel; do
				[ -z "$rel" ] && continue
				if [ ! -e "$src/$rel" ]; then
					echo "   - 上游已没有 $rel"
					continue
				fi
				if [ ! -e "$dest/$rel" ]; then
					echo "   + vendor 缺 $rel"
					continue
				fi
				if diff -rq "$src/$rel" "$dest/$rel" >/dev/null 2>&1; then
					echo "   = $rel"
				else
					echo "   ~ $rel 有差异："
					diff -rq "$src/$rel" "$dest/$rel" 2>&1 | sed 's/^/       /' | head -20
				fi
			done < <(files_for "$pkg")
		done
		echo
		echo "提示：vendor 里若有本地改动，应该搬进 src/（vendor 约定只读）。"
		;;

	--update)
		pkg="${2:-}"
		[ -z "$pkg" ] && { uses; exit 1; }
		src="$NPM_DIR/$pkg"
		ver="$(upstream_version "$pkg")"
		[ -z "$ver" ] && { echo "!! $pkg 未安装于 $NPM_DIR（先 pi install npm:$pkg）"; exit 1; }
		dest="$VENDOR_DIR/$pkg@$ver"
		mkdir -p "$dest"
		while read -r rel; do
			[ -z "$rel" ] && continue
			[ -e "$src/$rel" ] || { echo "   - 跳过（上游无此文件）: $rel"; continue; }
			mkdir -p "$dest/$(dirname "$rel")"
			cp -a "$src/$rel" "$dest/$(dirname "$rel")/"
			echo "   + $rel"
		done < <(files_for "$pkg")
		echo
		echo "已抽取到 $dest"
		echo "下一步："
		echo "  1) 确认 extensions/pi-tui-suite.ts 里的 import 指向这个版本目录"
		echo "  2) /reload 核对观感"
		echo "  3) 若版本号变了，在 README/UPSTREAM 里记一行"
		;;

	*)
		uses
		;;
esac
