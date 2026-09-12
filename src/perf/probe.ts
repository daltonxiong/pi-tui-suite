/**
 * 渲染探针（性能诊断，默认关闭）
 *
 * 为什么需要：pi-tui 没有视口虚拟化，每帧都会重渲染整个会话；而 fullscreen 模式下
 * 「每秒几帧」「每帧多少毫秒」「谁在请求重绘」都没有现成口子
 * （`PI_TUI_DEBUG_REDRAW` 只对 regular 模式有效，alt-screen 渲染器没有日志）。
 *
 * 探针提供三件事：
 *   1. `TuiAltScreen/TuiMainScreen.prototype.doRender` 的调用次数与耗时（avg/max）→ 每秒一行
 *   2. 同原型 `requestRender` 的调用次数（与帧数对比可看出是否存在重绘循环）
 *   3. 调用栈采样：`requestRender` 的调用方，以及 **alps-pi 防抖重绘定时器的创建方**
 *      （后者的栈才是「谁在请求」——渲染时的栈会被 33 ms 防抖吞掉）
 *
 * 关闭时零开销（不 patch 任何东西）；开启后只加 `performance.now()` 与定时器包装。
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

type Bucket = { frames: number; requests: number; totalMs: number; maxMs: number; debounceTimers: number };

const PATCH_FLAG = "__piTuiSuiteProbePatched";
const TIMER_PATCH_FLAG = "__piTuiSuiteTimerProbePatched";
/** alps-pi 防抖重绘定时器的特征串（回调体里含 `renderPendingFull`） */
const DEBOUNCE_TIMER_MARKER = "renderPendingFull";

export function installRenderProbe(pi: any, options: ProbeOptions, log: Logger): void {
	if (!options.enabled) return;

	/** 卸载回调：恢复原型 / 定时器 / 全局 setTimeout，并停止日志。 */
	const restores: Array<() => void> = [];
	let stopped = false;

	let bucket: Bucket = { frames: 0, requests: 0, totalMs: 0, maxMs: 0, debounceTimers: 0 };
	let lastSummary = Date.now();
	let lastStack = 0;

	const flush = (force = false): void => {
		if (stopped) return;
		const now = Date.now();
		const elapsedMs = now - lastSummary;
		if (!force && elapsedMs < options.summarySeconds * 1000) return;
		if (bucket.frames > 0 || bucket.requests > 0 || bucket.debounceTimers > 0) {
			const seconds = Math.max(0.001, elapsedMs / 1000);
			const per = (value: number) => `${value} (${(value / seconds).toFixed(1)}/s)`;
			log(
				`probe frames=${per(bucket.frames)} requests=${per(bucket.requests)} debounceTimers=${per(bucket.debounceTimers)} ` +
					`avgFrame=${(bucket.totalMs / Math.max(1, bucket.frames)).toFixed(1)}ms maxFrame=${bucket.maxMs.toFixed(1)}ms`,
			);
		}
		bucket = { frames: 0, requests: 0, totalMs: 0, maxMs: 0, debounceTimers: 0 };
		lastSummary = now;
	};

	/** 按间隔抓一次调用栈（超限返回 undefined）。 */
	const takeStack = (label: string): string | undefined => {
		if (stopped || options.stackEverySeconds <= 0) return undefined;
		const now = Date.now();
		if (lastStack !== 0 && now - lastStack < options.stackEverySeconds * 1000) return undefined;
		lastStack = now;
		try {
			const frames = String(new Error().stack ?? "")
				.split("\n")
				.slice(2, 9)
				.map((line) => line.trim().replace(/^at\s+/, ""))
				.filter((line) => !line.includes("node:internal") && !line.includes("patched"))
				.slice(0, 5);
			const text = `${label}: ${frames.join("  ←  ")}`;
			log(`probe ${text}`);
			return text;
		} catch {
			return undefined;
		}
	};

	let patchedCount = 0;
	const patchRenderer = (label: string, candidate: unknown): void => {
		const prototype = (candidate as any)?.prototype;
		if (!prototype || typeof prototype.doRender !== "function" || prototype[PATCH_FLAG]) return;

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
				// 说明：这个栈通常只能看到 alps-pi 的防抖定时器（真正的调用方见 debounceTimer 那一行）
				takeStack("stack(requestRender 调用方)");
				return originalRequest.apply(this, args);
			};
		}

		prototype[PATCH_FLAG] = true;
		patchedCount += 1;
		restores.push(() => {
			prototype.doRender = originalRender;
			if (typeof originalRequest === "function") prototype.requestRender = originalRequest;
			delete prototype[PATCH_FLAG];
		});
		void label;
	};

	patchRenderer("TuiAltScreen", TuiAltScreen);
	patchRenderer("TuiMainScreen", TuiMainScreen);

	// 给 alps-pi 的防抖重绘定时器拍「创建栈」：这才是「谁在请求重绘」的答案
	const globalAny = globalThis as any;
	if (!globalAny[TIMER_PATCH_FLAG]) {
		const originalSetTimeout = globalAny.setTimeout;
		globalAny.setTimeout = function patchedSetTimeout(this: unknown, callback: unknown, delay?: number, ...rest: unknown[]) {
			try {
				if (typeof callback === "function" && (delay ?? 0) <= 500) {
					if (Function.prototype.toString.call(callback).includes(DEBOUNCE_TIMER_MARKER)) {
						bucket.debounceTimers += 1;
						takeStack("debounceTimer 创建于");
					}
				}
			} catch {
				// 拍快照失败不能影响定时器本身
			}
			return originalSetTimeout.call(globalAny, callback as never, delay as never, ...(rest as never[]));
		};
		globalAny[TIMER_PATCH_FLAG] = true;
		restores.push(() => {
			globalAny.setTimeout = originalSetTimeout;
			delete globalAny[TIMER_PATCH_FLAG];
		});
	}

	const timer = setInterval(() => flush(true), Math.max(250, Math.floor(options.summarySeconds * 500)));
	timer.unref?.();

	// /reload、/new 都会触发 session_shutdown：那里把补丁和定时器撤干净。
	// 这一步很关键 —— 原型补丁和定时器是**进程级**的，不撤就会跨 reload 一直跑（实测踩过）。
	const uninstall = (): void => {
		stopped = true;
		clearInterval(timer);
		for (const restore of restores.splice(0)) {
			try {
				restore();
			} catch {
				// 恢复失败不影响其它逻辑
			}
		}
	};
	pi?.on?.("session_shutdown", () => uninstall());
	restores.push(() => clearInterval(timer));
	log(
		`probe 启动：summary=${options.summarySeconds}s stack=${options.stackEverySeconds}s ` +
			`patched=${patchedCount}/2（=0 且之前 reload 过 ⇒ 已挂载）`,
	);
}
