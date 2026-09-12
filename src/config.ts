/**
 * 配置读取 —— ~/.pi/agent/pi-tui-suite.json（缺省全部走内置默认值）
 *
 * 环境变量：
 *   PI_TUI_SUITE_CONFIG   配置文件路径（默认 ~/.pi/agent/pi-tui-suite.json）
 *   PI_TUI_SUITE_LOG      日志文件路径（覆盖配置里的 log；空字符串=关闭）
 *
 * 设计：任何字段缺失/非法都回退默认值，绝不因为配置问题让扩展抛错
 * （pi 的扩展加载失败会连带整个 TUI 启动告警，代价太高）。
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type BalanceProviderOverride = {
	/** 端点模板；`{baseUrl}` 会被替换成 pi 解析出的 baseUrl（去掉结尾斜杠） */
	url?: string;
	/** 解析方式：deepseek / openrouter-credits / openrouter-key */
	kind?: string;
	/** 覆盖货币符号，例如 "¥" */
	symbol?: string;
};

export type SuiteConfig = {
	log: string;
	/** alps-pi（vendored）：消息/工具线框 + 固定输入框 + footer + 动画 */
	alpsPi: {
		enabled: boolean;
		/** 启动时把动画帧率钉在该值（2/4/6/8/12/16/24/30）；null = 不干预，交给 /alps-pi 面板 */
		animationsFps: number | null;
	};
	/** 顶部 header（从 pi-open-tui 抽出来的唯一活着的部分） */
	/** 圆角工具框（pi-rounded-tools）。默认 false = 只留 alps-pi 那一层框 */
	roundedFrames: { enabled: boolean };
	header: { enabled: boolean };
	/** 复制净化：选中/复制时剥掉线框装饰（│、╭─╮ 等），默认开 */
	copyClean: { enabled: boolean };
	/** 渲染探针（性能诊断，默认关闭；开启时每秒往日志写一行帧率/帧耗时） */
	probe: { enabled: boolean; summarySeconds: number; stackEverySeconds: number };
	/** V8 采样剖分（性能诊断，默认关闭） */
	profile: { enabled: boolean; windowSeconds: number; topN: number; samplingIntervalUs: number };
	balance: {
		enabled: boolean;
		/** footer 角标前缀（现在默认空串：只显示「符号+金额」） */
		label: string;
		/** 轮询/节流间隔（秒）。默认 10s：既能看到花费，也不至于把 provider 打爆。 */
		refreshSeconds: number;
		/** ctx.ui.setStatus 用的 key（同 key 会覆盖） */
		statusKey: string;
		/** 网络超时（毫秒） */
		timeoutMs: number;
		/** 连续失败时的退避上限（秒）—— 429/5xx 时不会一直每 10s 撞一次 */
		maxBackoffSeconds: number;
		/** 按 provider id 子串覆盖/新增适配器，例如 { "my-gateway": { "url": "...", "kind": "deepseek" } } */
		providers: Record<string, BalanceProviderOverride>;
	};
};

export const DEFAULT_CONFIG: SuiteConfig = {
	log: "",
	alpsPi: { enabled: true, animationsFps: 4 },
	roundedFrames: { enabled: false },
	header: { enabled: true },
	copyClean: { enabled: true },
	probe: { enabled: false, summarySeconds: 1, stackEverySeconds: 20 },
	profile: { enabled: false, windowSeconds: 10, topN: 18, samplingIntervalUs: 500 },
	balance: {
		enabled: true,
		label: "",
		refreshSeconds: 10,
		statusKey: "balance",
		timeoutMs: 8000,
		maxBackoffSeconds: 120,
		providers: {},
	},
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown, fallback: string): string {
	return typeof value === "string" ? value : fallback;
}

function num(value: unknown, fallback: number, min: number): number {
	return typeof value === "number" && Number.isFinite(value) && value >= min ? value : fallback;
}

export function configPath(): string {
	return process.env.PI_TUI_SUITE_CONFIG || join(homedir(), ".pi", "agent", "pi-tui-suite.json");
}

export function loadSuiteConfig(): SuiteConfig {
	const defaults = DEFAULT_CONFIG;
	let raw: Record<string, unknown> = {};
	try {
		raw = JSON.parse(readFileSync(configPath(), "utf8")) as Record<string, unknown>;
	} catch {
		// 文件不存在或不是合法 JSON：全部走默认值
	}

	const balance = isRecord(raw.balance) ? raw.balance : {};
	const alpsPi = isRecord(raw.alpsPi) ? raw.alpsPi : {};
	const roundedFrames = isRecord(raw.roundedFrames) ? raw.roundedFrames : {};
	const header = isRecord(raw.header) ? raw.header : {};
	const copyClean = isRecord(raw.copyClean) ? raw.copyClean : {};
	const probe = isRecord(raw.probe) ? raw.probe : {};
	const profile = isRecord(raw.profile) ? raw.profile : {};
	const providers: Record<string, BalanceProviderOverride> = {};
	if (isRecord(balance.providers)) {
		for (const [key, value] of Object.entries(balance.providers)) {
			if (!isRecord(value)) continue;
			providers[key] = {
				url: typeof value.url === "string" ? value.url : undefined,
				kind: typeof value.kind === "string" ? value.kind : undefined,
				symbol: typeof value.symbol === "string" ? value.symbol : undefined,
			};
		}
	}

	// 旧字段 refreshMinutes 仍可写（向后兼容）：两者都没写就用默认 10s。
	const legacyMinutes = num(balance.refreshMinutes, Number.NaN, 0);
	const refreshSeconds = Number.isFinite(legacyMinutes)
		? legacyMinutes * 60
		: num(balance.refreshSeconds, defaults.balance.refreshSeconds, 1);

	return {
		log: str(process.env.PI_TUI_SUITE_LOG, str(raw.log, defaults.log)),
		alpsPi: {
			enabled: typeof alpsPi.enabled === "boolean" ? alpsPi.enabled : defaults.alpsPi.enabled,
			animationsFps:
				alpsPi.animationsFps === null
					? null
					: typeof alpsPi.animationsFps === "number" && Number.isFinite(alpsPi.animationsFps)
						? alpsPi.animationsFps
						: defaults.alpsPi.animationsFps,
		},
		roundedFrames: {
			enabled:
				typeof roundedFrames.enabled === "boolean" ? roundedFrames.enabled : defaults.roundedFrames.enabled,
		},
		header: {
			enabled: typeof header.enabled === "boolean" ? header.enabled : defaults.header.enabled,
		},
		copyClean: {
			enabled: typeof copyClean.enabled === "boolean" ? copyClean.enabled : defaults.copyClean.enabled,
		},
		probe: {
			enabled: typeof probe.enabled === "boolean" ? probe.enabled : defaults.probe.enabled,
			summarySeconds: num(probe.summarySeconds, defaults.probe.summarySeconds, 0.25),
			stackEverySeconds: num(probe.stackEverySeconds, defaults.probe.stackEverySeconds, 0),
		},
		profile: {
			enabled: typeof profile.enabled === "boolean" ? profile.enabled : defaults.profile.enabled,
			windowSeconds: num(profile.windowSeconds, defaults.profile.windowSeconds, 2),
			topN: num(profile.topN, defaults.profile.topN, 3),
			samplingIntervalUs: num(profile.samplingIntervalUs, defaults.profile.samplingIntervalUs, 100),
		},
		balance: {
			enabled: typeof balance.enabled === "boolean" ? balance.enabled : defaults.balance.enabled,
			label: str(balance.label, defaults.balance.label),
			refreshSeconds,
			statusKey: str(balance.statusKey, defaults.balance.statusKey),
			timeoutMs: num(balance.timeoutMs, defaults.balance.timeoutMs, 500),
			maxBackoffSeconds: num(balance.maxBackoffSeconds, defaults.balance.maxBackoffSeconds, 0),
			providers,
		},
	};
}
