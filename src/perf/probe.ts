/**
 * 渲染探针（性能诊断，默认关闭）
 *
 * 为什么需要：pi-tui 没有视口虚拟化，每帧都会重渲染整个会话；而「每秒几帧」「每帧多少毫秒」
 * 「谁在请求重绘」这三件事在 fullscreen 模式下没有任何现成口子
 * （`PI_TUI_DEBUG_REDRAW` 只对 regular 模式有效，alt-screen 渲染器没有日志）。
 * 这里直接给渲染器原型打桩：
 *
 *   - `TuiAltScreen/TuiMainScreen.prototype.doRender` 调用次数 + 耗时（avg/max）→ 每秒一行
 *   - `requestRender` 调用次数 → 若有「自我触发」的重绘循环，这里的数字会远大于帧数
 *   - 每 stackEverySeconds 秒抓一次 `requestRender` 的调用栈（去重前几帧）→ 定位请求来源
 *
 * 关闭时零开销（不 patch 任何东西）。
 */

import { TuiAltScreen, TuiMainScreen } from "@earendil-works/pi-tui";
import type { Logger } from "../log.ts";

export type ProbeOptions = {
	enabled: boolean;
	/** 汇总输出间隔（秒） */
	summarySeconds: number;
	/** 抓调用栈的间隔（秒）；0 = 不抓 */
	stackEverySeconds: number;
};

type Bucket = { frames: number; requests: number; totalMs: number; maxMs: number };
const PATCH_FLAG = "__piTuiSuiteProbePatched";

export function installRenderProbe(options: ProbeOptions, log: Logger): void {
	if (!options.enabled) return;

	let bucket: Bucket = { frames: 0, requests: 0, totalMs: 0, maxMs: 0 };
	let lastSummary = Date.now();
	let lastStack = Date.now();

	const flush = (force = false): void => {
		const now = Date.now();
		const elapsedMs = now - lastSummary;
		if (!force && elapsedMs < options.summarySeconds * 1000) return;
		if (bucket.frames > 0 || bucket.requests > 0) {
			const seconds = Math.max(0.001, elapsedMs / 1000);
			log(
				`probe frames=${bucket.frames} (${(bucket.frames / seconds).toFixed(1)}/s) ` +
					`requests=${bucket.requests} (${(bucket.requests / seconds).toFixed(1)}/s) ` +
					`avgFrame=${(bucket.totalMs / Math.max(1, bucket.frames)).toFixed(1)}ms ` +
					`maxFrame=${bucket.maxMs.toFixed(1)}ms`,
			);
		}
		bucket = { frames: 0, requests: 0, totalMs: 0, maxMs: 0 };
		lastSummary = now;
	};

	const maybeStack = (): void => {
		if (options.stackEverySeconds <= 0) return;
		const now = Date.now();
		if (now - lastStack < options.stackEverySeconds * 1000) return;
		lastStack = now;
		try {
			const frames = String(new Error().stack ?? "")
				.split("\n")
				.slice(2, 9)
				.map((line) => line.trim().replace(/^at\s+/, ""))
				.filter((line) => !line.includes("node:internal") && !line.includes("patchedRequestRender"))
				.slice(0, 5);
			log(`probe stack(requestRender 调用方): ${frames.join("  ←  ")}`);
		} catch {
			// 拿不到调用栈就算了
		}
	};

	let patchedCount = 0;
	const patch = (label: string, candidate: unknown): void => {
		const prototype = (candidate as any)?.prototype;
		if (!prototype || typeof prototype.doRender !== "function") {
			log(`probe: ${label} 没有可用的 doRender，跳过`);
			return;
		}
		if (prototype[PATCH_FLAG]) return;

		const originalRender = prototype.doRender;
		prototype.doRender = function patchedDoRender(this: unknown, ...args: unknown[]) {
			const started = performance.now();
			try {
				return originalRender.apply(this, args);
			} finally {
				const cost = performance.now() - started;
				bucket.frames += 1;
				bucket.totalMs += cost;
				if (cost > bucket.maxMs) bucket.maxMs = cost;
				flush();
			}
		};

		const originalRequest = prototype.requestRender;
		if (typeof originalRequest === "function") {
			prototype.requestRender = function patchedRequestRender(this: unknown, ...args: unknown[]) {
				bucket.requests += 1;
				maybeStack();
				return originalRequest.apply(this, args);
			};
		}

		prototype[PATCH_FLAG] = true;
		patchedCount += 1;
	};

	patch("TuiAltScreen", TuiAltScreen);
	patch("TuiMainScreen", TuiMainScreen);

	const timer = setInterval(() => flush(true), Math.max(250, Math.floor(options.summarySeconds * 500)));
	timer.unref?.();
	log(
		`probe 启动：summary=${options.summarySeconds}s stack=${options.stackEverySeconds}s ` +
			`patched=${patchedCount}/2（=0 说明扩展拿到的不是 pi 正在用的那份模块实例）`,
	);
}
