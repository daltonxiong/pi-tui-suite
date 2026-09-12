/**
 * 自动 CPU 剖分（V8 sampling profiler）—— 找出「每帧 65 ms 到底花在哪」
 *
 * 背景：fullscreen 模式每帧要重渲染整个会话，实测单帧 ~65 ms；但具体是 pi 的布局/行处理、
 * alps-pi 的线框装箱、还是别的扩展，光读代码判断不出来（而且 alps-pi 的请求经过 33 ms 防抖，
 * 调用栈也被吞掉）。所以直接用 `node:inspector` 的 Profiler 做采样：
 *
 *   每 windowSeconds 秒采一段，按「自耗时」聚合，把 topN 个热点函数写进日志
 *   （形如 `  1234.5ms  65.2%  Container.render  @ /path/to/.../tui.js:123`）
 *
 * 开销：采样间隔 500µs，自身开销约 1–3%，默认关闭。
 */

import { Session } from "node:inspector";
import type { Logger } from "../log.ts";

export type ProfileOptions = {
	enabled: boolean;
	/** 每段采样时长（秒） */
	windowSeconds: number;
	/** 每段输出的热点条数 */
	topN: number;
	/** 采样间隔（微秒），越小越精确、开销越大 */
	samplingIntervalUs: number;
};

type ProfileNode = {
	id: number;
	callFrame: { functionName?: string; url?: string; lineNumber?: number };
	children?: number[];
};

export function startAutoProfiler(options: ProfileOptions, log: Logger): void {
	if (!options.enabled) return;

	const session = new Session();
	session.connect();
	const post = <T>(method: string, params?: Record<string, unknown>): Promise<T> =>
		new Promise<T>((resolve, reject) => {
			session.post(method, params, (error, result) => (error ? reject(error) : resolve(result as T)));
		});

	let busy = false;

	const summarize = (profile: any): void => {
		const nodes = new Map<number, ProfileNode>();
		for (const node of profile.nodes as ProfileNode[]) nodes.set(node.id, node);

		// 栈树：child → parent，用于把热点回溯到「谁在调」
		const parentOf = new Map<number, number>();
		for (const node of nodes.values()) {
			for (const child of node.children ?? []) parentOf.set(child, node.id);
		}
		const shortFile = (url: string): string => {
			if (!url) return "native";
			const parts = url.split("/");
			return parts.slice(-1)[0] || url;
		};
		const label = (id: number): string => {
			const node = nodes.get(id);
			const name = String(node?.callFrame?.functionName || "(anonymous)");
			return `${name}@${shortFile(String(node?.callFrame?.url ?? ""))}`;
		};
		const chain = (id: number): string => {
			const parts: string[] = [];
			let current: number | undefined = id;
			for (let guard = 0; current !== undefined && guard < 7; guard += 1) {
				parts.push(label(current));
				current = parentOf.get(current);
			}
			return parts.join(" ← ");
		};

		// 自耗时 = 该节点在 samples 里出现的次数 × 采样间隔；按「函数名+文件」聚合（同一函数可能有多个取样节点）
		const selfSamples = new Map<number, number>();
		for (const id of (profile.samples ?? []) as number[]) {
			selfSamples.set(id, (selfSamples.get(id) ?? 0) + 1);
		}
		const totalSamples = (profile.samples ?? []).length || 1;
		const perSampleMs = options.samplingIntervalUs / 1000;

		type Row = { name: string; where: string; ms: number; pct: number; chain: string };
		const byFunction = new Map<string, Row>();
		for (const [id, count] of selfSamples.entries()) {
			const node = nodes.get(id);
			const url = String(node?.callFrame?.url ?? "");
			const name = String(node?.callFrame?.functionName || "(anonymous)");
			const key = `${name}@${url}`;
			const row =
				byFunction.get(key) ??
				({
					name,
					where: `${shortFile(url)}:${(node?.callFrame?.lineNumber ?? 0) + 1}`,
					ms: 0,
					pct: 0,
					chain: chain(id),
				} as Row);
			row.ms += count * perSampleMs;
			byFunction.set(key, row);
		}

		const rows = [...byFunction.values()]
			.map((row) => ({ ...row, pct: (row.ms / (totalSamples * perSampleMs)) * 100 }))
			.sort((a, b) => b.ms - a.ms)
			.slice(0, options.topN);

		log(`── profile 汇总（${options.windowSeconds}s，采样 ${totalSamples} 个）──`);
		for (const row of rows) {
			log(`   ${row.ms.toFixed(1).padStart(8)}ms  ${row.pct.toFixed(1).padStart(5)}%  ${row.name}  @ ${row.where}`);
			log(`            ↳ ${row.chain}`);
		}
	};

	const cycle = async (): Promise<void> => {
		if (busy) return;
		busy = true;
		try {
			await post("Profiler.enable");
			await post("Profiler.setSamplingInterval", { interval: options.samplingIntervalUs });
			await post("Profiler.start");
			await new Promise((resolve) => setTimeout(resolve, options.windowSeconds * 1000).unref?.());
			const { profile } = await post<{ profile: unknown }>("Profiler.stop");
			summarize(profile);
			await post("Profiler.disable");
		} catch (error) {
			log(`profile 失败: ${error instanceof Error ? error.message : String(error)}`);
		} finally {
			busy = false;
		}
	};

	const timer = setInterval(() => void cycle(), options.windowSeconds * 1000 + 1000);
	timer.unref?.();
	void cycle();
	log(`剖分器启动：每 ${options.windowSeconds}s 采一段，输出 top ${options.topN}`);
}
