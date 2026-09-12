/**
 * 可选日志 —— 默认全关（路径为空即 no-op，零开销）
 *
 * 排查用：export PI_TUI_SUITE_LOG=$TMPDIR/pi-tui-suite.log
 * 或写进 ~/.pi/agent/pi-tui-suite.json 的 "log": "$HOME/tmp/pi-tui-suite.log"（不支持 ~ 展开，写绝对路径）。
 * 超过 256 KB 自动清空，避免在手机上堆文件。
 */

import { appendFileSync, statSync, writeFileSync } from "node:fs";

export type Logger = (message: string) => void;

const MAX_BYTES = 256 * 1024;

export function createLogger(path: string): Logger {
	if (!path) return () => {};
	let lines = 0;
	return (message: string) => {
		try {
			appendFileSync(path, `${new Date().toISOString()} ${message}\n`);
			if (++lines % 100 !== 0) return;
			if (statSync(path).size > MAX_BYTES) writeFileSync(path, "");
		} catch {
			// 日志失败绝不影响主流程
		}
	};
}
