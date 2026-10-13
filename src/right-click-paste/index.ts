/**
 * Windows 右击粘贴去重 —— 让「终端自带粘贴」与「pi 合成粘贴」不要同时生效
 *
 * 问题（Windows，fullscreen 模式）：pi 打开鼠标追踪后，终端会把右键按下
 * （SGR `ESC[<2;x;yM`）转发给应用，pi 的 `TuiAltScreen.handleRightClickPaste()`
 * 于是自己去读剪贴板并注入 `ESC[200~...ESC[201~`；但**有些终端自己也会粘贴**
 * （VS Code 的 `rightClickBehavior`、Orca 的终端等）⇒ 一次右击，输入框收到两份。
 *
 * 上游只对 `TERM_PROGRAM=vscode` 做了规避（issue #8186），Orca 被报告过却没修
 * （issue #10825 自动关闭）。本模块把该规避**本地化并参数化**：命中的终端跳过
 * pi 的合成粘贴，交给终端自己的粘贴路径（否则 Windows Terminal 这类「只转发不粘贴」
 * 的终端会彻底失去右击粘贴，所以不能一刀切关闭）。
 *
 * 做法：包住 `TuiAltScreen.prototype.handleRightClickPaste`。只做「跳过哪些终端」这一件事，
 * 命中就直接返回 `false`（事件未被消费，交由终端处理）；其余原样交给上游实现
 * —— 这样上游将来补的判定不会被覆盖掉。
 */

import { TuiAltScreen } from "@earendil-works/pi-tui";
import type { Logger } from "../log.ts";

const PATCH_FLAG = "__piTuiSuiteRightClickPastePatched";

/** 当前终端的 TERM_PROGRAM 是否在「跳过 pi 合成粘贴」名单里。 */
export function shouldSkipSyntheticRightClickPaste(
	termProgram: string | undefined,
	skipTerminals: readonly string[],
): boolean {
	const term = String(termProgram ?? "").trim().toLowerCase();
	if (!term) return false;
	return skipTerminals.some((value) => value.trim().toLowerCase() === term);
}

/**
 * 给渲染器挂上右击粘贴去重；返回卸载函数（/reload、/new 时由装配层调用）。
 *
 * 只在 win32 上打补丁：非 Windows 平台上游本就不会走合成粘贴，补了也只是多一层调用。
 */
export function installRightClickPasteGuard(
	enabled: boolean,
	skipTerminals: readonly string[],
	log: Logger,
): () => void {
	if (!enabled || process.platform !== "win32") return () => undefined;
	if (skipTerminals.length === 0) return () => undefined;

	const prototype = (TuiAltScreen as unknown as { prototype?: Record<string, unknown> })?.prototype;
	const original = prototype?.handleRightClickPaste;
	if (!prototype || typeof original !== "function" || prototype[PATCH_FLAG]) {
		return () => undefined;
	}

	const originalHandleRightClickPaste = original as (this: unknown, event: { release?: boolean; button?: number }) => boolean;
	prototype.handleRightClickPaste = function patchedHandleRightClickPaste(
		this: unknown,
		event: { release?: boolean; button?: number },
	) {
		if (shouldSkipSyntheticRightClickPaste(process.env.TERM_PROGRAM, skipTerminals)) return false;
		return originalHandleRightClickPaste.call(this, event);
	};
	prototype[PATCH_FLAG] = true;
	log(`rightClickPaste: 已挂载（${skipTerminals.join("/")} 终端让位给原生粘贴）`);

	return () => {
		prototype.handleRightClickPaste = originalHandleRightClickPaste;
		delete prototype[PATCH_FLAG];
	};
}
