/**
 * 复制净化 —— 让「选中 → 复制」拿到的文本不带线框装饰
 *
 * 问题：线框（`│ 代码 │`、`╭─ TOOL bash ─╮`、`╰──╯`）是**渲染成字符**的，
 * 终端复制选区时会把它们一起带走 ⇒ 粘出来每行两头都是 `│`，代码不能直接用。
 *
 * 做法：钩住 alt-screen 渲染器的 `copyTextToClipboard()` —— 它是所有复制路径的汇合点
 * （`copySelectionToClipboard()` → `copyTextToClipboard()`；`fullscreenCopyOnSelect`
 * 的自动复制也走这里），在写剪贴板之前把装饰剥掉。
 *
 * 只删**装饰**，不动正文：
 *   - 丢掉整行边框（行首 `╭`/`╰` 且行尾 `╮`/`╯`，包括带标签的 `╭─ TOOL bash ✓ ─╮`）
 *   - 每行去掉最外层的一个 `│` + 紧随的一个空格（行内自身的缩进保留）
 *   - 去掉线框补出来的行尾填充空格、首尾空行、以及残留的 ANSI/OSC 序列
 *
 * 想恢复原样（连框线一起复制）：配置里 `"copyClean": { "enabled": false }`。
 */

import { TuiAltScreen } from "@earendil-works/pi-tui";
import type { Logger } from "../log.ts";

const PATCH_FLAG = "__piTuiSuiteCopyCleanPatched";

/** 去掉终端控制序列（SGR/OSC），避免粘出来带转义码。 */
function stripAnsi(text: string): string {
	return text
		.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
		.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

/** 把「带线框的选区文本」还原成干净正文。 */
export function stripFrameDecoration(text: string): string {
	const out: string[] = [];
	for (const raw of String(text ?? "").split("\n")) {
		const line = stripAnsi(raw).replace(/\s+$/, "");
		const trimmed = line.trim();
		if (!trimmed) {
			out.push("");
			continue;
		}
		// 整行上下边框（含带标签的）：╭─ ... ─╮ / ╰─ ... ─╯
		if (trimmed.length >= 2 && /^[╭╰]/.test(trimmed) && /[╮╯]$/.test(trimmed)) {
			continue;
		}
		// 内容行：剥掉最外层「一个竖线 + 一个空格」，行内缩进保留
		const body = line.replace(/^\s*│ ?/, "").replace(/\s*│\s*$/, "").replace(/\s+$/, "");
		out.push(body);
	}
	while (out.length > 0 && out[0] === "") out.shift();
	while (out.length > 0 && out[out.length - 1] === "") out.pop();
	return out.join("\n");
}

/** 给渲染器挂上复制净化；返回卸载函数（/reload、/new 时由装配层调用）。 */
export function installCopyClean(enabled: boolean, log: Logger): () => void {
	if (!enabled) return () => undefined;
	const prototype = (TuiAltScreen as unknown as { prototype?: Record<string, unknown> })?.prototype;
	if (!prototype || typeof prototype.copyTextToClipboard !== "function" || prototype[PATCH_FLAG]) {
		return () => undefined;
	}

	const originalCopy = prototype.copyTextToClipboard as (this: unknown, text: string) => unknown;
	prototype.copyTextToClipboard = function patchedCopyTextToClipboard(this: unknown, text: string) {
		return originalCopy.call(this, stripFrameDecoration(String(text ?? "")));
	};
	prototype[PATCH_FLAG] = true;
	log("copyClean: 已挂载（复制时剥掉线框装饰）");

	return () => {
		prototype.copyTextToClipboard = originalCopy;
		delete prototype[PATCH_FLAG];
	};
}
