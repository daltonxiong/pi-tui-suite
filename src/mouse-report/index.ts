/**
 * ConPTY 下的鼠标上报重放 —— 让 fullscreen 模式真正接管鼠标（滚轮 / 选区复制）
 *
 * 根因（上游 issue #9656、PR #10560）：pi-tui 的 `TuiAltScreen.beforeTerminalStart()` 在
 * `ProcessTerminal.start()` **之前**写鼠标 DECSET（`?1000h ?1002h ?1003h ?1004h ?1006h`）。
 * Windows 的终端输入经 ConPTY，此时 stdin 还没 `setRawMode(true)` / `ENABLE_VIRTUAL_TERMINAL_INPUT`，
 * ConPTY 会吞掉这些序列 ⇒ 外层终端从未启用鼠标上报：
 *   - 滚轮被终端按 alternateScroll 转成上下键 / 翻输入历史，而不是滚 transcript；
 *   - 鼠标选择走终端的原生选区/右键菜单复制，绕过 pi 与 `copyClean`，粘出来每行两头都带 `│`。
 * WSL 里的 pi 同样经 ConPTY（wsl.exe → Windows Terminal），所以一并处理。
 *
 * 做法：包住 `TuiAltScreen.prototype.afterTerminalStart()`（它在 `terminal.start()` 之后调用，
 * raw mode 已开），重放与 `beforeTerminalStart()` 相同的鼠标序列。DECSET `h` 幂等，重复写无害；
 * 只重放鼠标，不碰 alt-screen / autowrap / 清屏等其它输出。
 *
 * 平台限定：win32，或运行在 WSL 里（`WSL_DISTRO_NAME`）。原生 Linux / macOS 不走 ConPTY，
 * 上游本来就正常。环境变量 `PI_TUI_SUITE_MOUSE_REPLAY=0` 可临时关闭。
 *
 * 上游修好后（把 mouse DECSET 移到 afterTerminalStart）本模块即可删除。
 */

import { TuiAltScreen } from "@earendil-works/pi-tui";
import type { Logger } from "../log.ts";

const PATCH_FLAG = "__piTuiSuiteMouseReportPatched";

// 与 pi-tui 的 TuiAltScreen 常量保持一致：多路复用器用 button-motion（1002），
// 其余用 all-motion（1003）。
const ENABLE_ALL_MOTION_MOUSE = "\x1b[?1000h\x1b[?1002h\x1b[?1003h\x1b[?1004h\x1b[?1006h";
const ENABLE_BUTTON_MOTION_MOUSE = "\x1b[?1000h\x1b[?1002h\x1b[?1004h\x1b[?1006h";

/** 当前平台是否需要重放（win32 或 WSL；`PI_TUI_SUITE_MOUSE_REPLAY=0` 可关）。 */
export function needsMouseReportReplay(
	platform: NodeJS.Platform = process.platform,
	env: NodeJS.ProcessEnv = process.env,
): boolean {
	if (env.PI_TUI_SUITE_MOUSE_REPLAY === "0") return false;
	return platform === "win32" || (platform === "linux" && Boolean(env.WSL_DISTRO_NAME));
}

/** 与 pi 的选择逻辑一致：tmux/screen/zellij 用 button-motion，否则 all-motion。 */
export function mouseReportSequence(env: NodeJS.ProcessEnv = process.env): string {
	const term = (env.TERM ?? "").toLowerCase();
	const multiplexer =
		env.TMUX !== undefined ||
		env.ZELLIJ !== undefined ||
		env.STY !== undefined ||
		term.startsWith("tmux") ||
		term.startsWith("screen");
	return multiplexer ? ENABLE_BUTTON_MOTION_MOUSE : ENABLE_ALL_MOTION_MOUSE;
}

type MouseReportTarget = {
	mouseEnabled?: boolean;
	terminal?: { write?: (data: string) => void };
};

/**
 * 把鼠标上报序列写给渲染器的 terminal；`mouseEnabled === false`（pi 的 `mouse` 设置为关）时跳过。
 * 返回写入的序列，便于测试。
 */
export function replayMouseReport(target: MouseReportTarget, env: NodeJS.ProcessEnv = process.env): string | undefined {
	if (target.mouseEnabled === false) return undefined;
	const sequence = mouseReportSequence(env);
	target.terminal?.write?.(sequence);
	return sequence;
}

/** 检查补丁是否已挂在当前模块的 TuiAltScreen 原型上（冒烟测试用）。 */
export function isMouseReportPatched(): boolean {
	return Boolean((TuiAltScreen.prototype as unknown as Record<string, unknown>)?.[PATCH_FLAG]);
}

/**
 * 安装补丁；返回卸载函数（/reload、/new 时由装配层调用）。
 * 必须在 TUI 第一次 start 之前调用（扩展加载阶段即可）。
 */
export function installMouseReportReplay(enabled: boolean, log: Logger): () => void {
	if (!enabled || !needsMouseReportReplay()) return () => undefined;

	const prototype = (TuiAltScreen as unknown as { prototype?: Record<string, unknown> })?.prototype;
	if (!prototype || prototype[PATCH_FLAG]) return () => undefined;

	const hadOwnAfterTerminalStart = Object.prototype.hasOwnProperty.call(prototype, "afterTerminalStart");
	const original = prototype.afterTerminalStart;
	const originalAfter = typeof original === "function" ? (original as (this: unknown) => void) : undefined;

	prototype.afterTerminalStart = function patchedAfterTerminalStart(this: unknown) {
		originalAfter?.call(this);
		try {
			replayMouseReport(this as MouseReportTarget);
		} catch {
			// 写失败只影响鼠标上报，不影响 TUI 启动
		}
	};
	prototype[PATCH_FLAG] = true;
	log("mouseReport: 已挂载（ConPTY 下在 raw mode 之后重放鼠标上报序列）");

	return () => {
		if (hadOwnAfterTerminalStart) prototype.afterTerminalStart = original;
		else delete prototype.afterTerminalStart;
		delete prototype[PATCH_FLAG];
	};
}
