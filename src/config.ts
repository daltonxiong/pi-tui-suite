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
	balance: {
		enabled: boolean;
		/** footer 角标前缀，默认 "余 "；设空串只显示金额 */
		label: string;
		/** 自动刷新间隔（分钟）；turn_end 时只在超过该间隔后刷新 */
		refreshMinutes: number;
		/** ctx.ui.setStatus 用的 key（同 key 会覆盖） */
		statusKey: string;
		/** 网络超时（毫秒） */
		timeoutMs: number;
		/** 按 provider id 子串覆盖/新增适配器，例如 { "my-gateway": { "url": "...", "kind": "deepseek" } } */
		providers: Record<string, BalanceProviderOverride>;
	};
};

export const DEFAULT_CONFIG: SuiteConfig = {
	log: "",
	balance: {
		enabled: true,
		label: "余 ",
		refreshMinutes: 10,
		statusKey: "balance",
		timeoutMs: 8000,
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

	return {
		log: str(process.env.PI_TUI_SUITE_LOG, str(raw.log, defaults.log)),
		balance: {
			enabled: typeof balance.enabled === "boolean" ? balance.enabled : defaults.balance.enabled,
			label: str(balance.label, defaults.balance.label),
			refreshMinutes: num(balance.refreshMinutes, defaults.balance.refreshMinutes, 0),
			statusKey: str(balance.statusKey, defaults.balance.statusKey),
			timeoutMs: num(balance.timeoutMs, defaults.balance.timeoutMs, 500),
			providers,
		},
	};
}
