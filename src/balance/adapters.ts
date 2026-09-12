/**
 * 余额适配器表 —— 把"某个 provider 的余额怎么查、怎么解析"集中在这里
 *
 * 已核实可用（2026-09-12 实测本机 key，HTTP 200）：
 *   deepseek        GET {base}/user/balance   → {"balance_infos":[{"currency":"CNY","total_balance":"17.45",...}]}
 *   *openrouter*    GET {base}/credits        → {"data":{"total_credits":0,"total_usage":0.000459908}}
 *   *openrouter*    GET {base}/key            → {"data":{"limit":null,"limit_remaining":null,"usage":...}}
 *
 * 已核实**没有**余额接口（返回 404，别浪费时间去猜）：
 *   free-opencode (https://opencode.ai/zen/v1)   —— /credits、/key 都是 404
 *   free-nvidia   (https://integrate.api.nvidia.com/v1) —— /credits 404
 *   这两个 provider 的模型名都以 -free 结尾，本来就是免费额度，没有余额概念。
 *
 * 想加新 provider：在 ~/.pi/agent/pi-tui-suite.json 的 balance.providers 里加一条
 *   { "my-gateway": { "url": "https://my.gw/v1/credits", "kind": "openrouter-credits" } }
 * 已有 kind 复用即可；全新的响应格式再加一个 kind（本文件里加解析分支）。
 */

import type { BalanceProviderOverride } from "../config.ts";

export type BalanceKind = "deepseek" | "openrouter-credits" | "openrouter-key";

export type BalanceAdapter = {
	/** provider id 匹配用的子串（不区分大小写，按表内顺序第一个命中胜出） */
	match: string;
	kind: string;
	/** 端点模板；`{baseUrl}` = pi 解析出的 baseUrl（结尾斜杠已去掉） */
	url: string;
	/** pi 解析不出 baseUrl 时的兵库（必须带 /v1 那种真实前缀） */
	defaultBaseUrl: string;
	/** 货币符号覆盖（deepseek 是 CNY，openrouter 是 USD，一般不用改） */
	symbol?: string;
};

export type BalanceResult = {
	amount: number;
	currency: string;
	symbol: string;
	/** /balance 命令展示的原始细节 */
	detail: string;
};

const BUILTIN: BalanceAdapter[] = [
	{ match: "deepseek", kind: "deepseek", url: "{baseUrl}/user/balance", defaultBaseUrl: "https://api.deepseek.com" },
	{
		match: "openrouter",
		kind: "openrouter-credits",
		url: "{baseUrl}/credits",
		defaultBaseUrl: "https://openrouter.ai/api/v1",
	},
];

const SYMBOLS: Record<string, string> = { CNY: "¥", USD: "$", EUR: "€", GBP: "£", JPY: "¥" };

/** 按 provider id 找适配器：先看用户覆盖（子串匹配），再看内置表。 */
export function resolveAdapter(
	providerId: string,
	overrides: Record<string, BalanceProviderOverride> = {},
): BalanceAdapter | undefined {
	const id = String(providerId || "").toLowerCase();
	for (const [key, value] of Object.entries(overrides)) {
		if (!value?.url || !id.includes(key.toLowerCase())) continue;
		return {
			match: key,
			kind: value.kind ?? "deepseek",
			url: value.url,
			defaultBaseUrl: value.url.replace(/\{[^}]*\}/, "").replace(/\/[^/]*$/, ""),
			symbol: value.symbol,
		};
	}
	return BUILTIN.find((adapter) => id.includes(adapter.match));
}

/** 把端点模板里的 {baseUrl} 展开；baseUrl 缺省时用适配器自带的兵库。 */
export function expandUrl(adapter: BalanceAdapter, baseUrl: string | undefined): string {
	const base = (baseUrl || adapter.defaultBaseUrl).replace(/\/+$/, "");
	return adapter.url.replace("{baseUrl}", base);
}

function toNumber(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
	return undefined;
}

function symbolFor(currency: string, override?: string): string {
	return override ?? SYMBOLS[currency.toUpperCase()] ?? `${currency.toUpperCase()} `;
}

/** 解析响应体；无法识别时抛错（调用方决定"保留旧值"还是"报错"）。 */
export function parseBalancePayload(kind: string, payload: unknown, symbolOverride?: string): BalanceResult {
	const data = (payload ?? {}) as Record<string, any>;

	if (kind === "deepseek") {
		const info = Array.isArray(data.balance_infos) ? data.balance_infos[0] : undefined;
		const amount = toNumber(info?.total_balance) ?? toNumber(data.total_balance);
		if (amount === undefined) throw new Error("deepseek: 响应里没有 balance_infos[0].total_balance");
		const currency = String(info?.currency ?? "CNY");
		const available = data.is_available === false ? "不可用" : "可用";
		return {
			amount,
			currency,
			symbol: symbolFor(currency, symbolOverride),
			detail: `账户${available}；充值余额 ${info?.topped_up_balance ?? "?"}，赠送 ${info?.granted_balance ?? "?"}`,
		};
	}

	if (kind === "openrouter-credits") {
		const credits = toNumber(data.data?.total_credits);
		const usage = toNumber(data.data?.total_usage) ?? 0;
		if (credits === undefined) throw new Error("openrouter: 响应里没有 data.total_credits");
		return {
			amount: Math.max(0, credits - usage),
			currency: "USD",
			symbol: symbolFor("USD", symbolOverride),
			// 免费模型产生的用量会让 credits-usage 变成负数，这里夹到 0，原始值放 detail
			detail: `充值额度 $${credits}，已用 $${usage}（原始余额 $${(credits - usage).toFixed(6)}）`,
		};
	}

	if (kind === "openrouter-key") {
		const remaining = toNumber(data.data?.limit_remaining);
		const limit = toNumber(data.data?.limit);
		const usage = toNumber(data.data?.usage) ?? 0;
		if (remaining === undefined) throw new Error("openrouter: 该 key 没有 limit_remaining（未设额度上限）");
		return {
			amount: Math.max(0, remaining),
			currency: "USD",
			symbol: symbolFor("USD", symbolOverride),
			detail: `额度 $${limit ?? "无上限"}，已用 $${usage}`,
		};
	}

	throw new Error(`未知的余额 kind: ${kind}`);
}

/** 金额格式化：≥1 用 2 位小数；<1 用 4 位，避免 $0.00 看不出是"刚好花完"还是"几乎没花"。 */
export function formatAmount(amount: number): string {
	const abs = Math.abs(amount);
	if (abs >= 1) return amount.toFixed(2);
	if (abs === 0) return "0.00";
	return amount.toFixed(4);
}

/** footer 角标文本，例如 "¥42.50"（label 为空时只显示符号 + 金额）。 */
export function formatStatusText(result: BalanceResult, label: string): string {
	return `${label}${result.symbol}${formatAmount(result.amount)}`;
}
