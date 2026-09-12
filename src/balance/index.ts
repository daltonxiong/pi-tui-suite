/**
 * 余额角标 —— 在 footer 显示当前 provider 的账户余额（阶段 1 功能）
 *
 * 机制：pi 的扩展状态（ctx.ui.setStatus）会由 footer 渲染（当前由 alps-pi 的 footer 以 `›` 分隔展示），
 * 所以这个模块**不需要碰任何渲染代码**，与三个美化插件零冲突 —— 这也是把它作为套件第一个模块的原因。
 *
 * 取数策略（都不阻塞主流程，失败保留上一次的值）：
 *   session_start / model_select → 立刻拉一次（provider 变了必须换）
 *   turn_end                     → 距上次超过 refreshMinutes 才拉（长会话自动刷新，不刷屏）
 *   /balance                     → 强制拉一次并把明细 notify 出来
 *
 * provider → 接口的映射、以及"哪些 provider 根本没有余额接口"见 adapters.ts 头部注释。
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { SuiteConfig } from "../config.ts";
import type { Logger } from "../log.ts";
import {
	type BalanceResult,
	expandUrl,
	formatStatusText,
	parseBalancePayload,
	resolveAdapter,
} from "./adapters.ts";

type BalanceConfig = SuiteConfig["balance"];

type ResolvedAuth = {
	apiKey?: string;
	baseUrl?: string;
	headers?: Record<string, string>;
	source: string;
};

const AUTH_JSON = join(homedir(), ".pi", "agent", "auth.json");

export function installBalanceStatus(pi: any, config: BalanceConfig, log: Logger): void {
	let cached:
		| { text: string; result: BalanceResult; provider: string; at: number; url: string }
		| undefined;
	let inflight: Promise<void> | undefined;

	/** 解析当前 provider 的请求凭据：官方 API 优先，读 auth.json 兜底。 */
	async function resolveAuth(ctx: any, providerId: string): Promise<ResolvedAuth> {
		const registry = ctx?.modelRegistry;

		// 1) 按模型解析（models.json 的 baseUrl/headers 覆盖都算进去了，最准）
		try {
			if (ctx?.model && typeof registry?.getApiKeyAndHeaders === "function") {
				const auth = await registry.getApiKeyAndHeaders(ctx.model);
				if (auth?.ok) {
					return {
						apiKey: auth.apiKey,
						baseUrl: auth.baseUrl,
						headers: auth.headers,
						source: "getApiKeyAndHeaders",
					};
				}
				if (auth?.ok === false && auth.error) log(`auth(getApiKeyAndHeaders): ${auth.error}`);
			}
		} catch (error) {
			log(`auth(getApiKeyAndHeaders) 失败: ${describe(error)}`);
		}

		// 2) 按 provider 解析（不同 pi 版本返回结构不同，逐个试）
		try {
			if (typeof registry?.getProviderAuth === "function") {
				const auth = await registry.getProviderAuth(providerId);
				if (auth) {
					const key = auth.key ?? auth.apiKey;
					if (key) {
						return { apiKey: key, baseUrl: auth.baseUrl, headers: auth.headers, source: "getProviderAuth" };
					}
				}
			}
		} catch (error) {
			log(`auth(getProviderAuth) 失败: ${describe(error)}`);
		}

		// 3) 兜底：直接读 auth.json（结构 { "<provider>": { type: "api_key", key: "..." } }）
		try {
			const store = JSON.parse(readFileSync(AUTH_JSON, "utf8")) as Record<string, { key?: string }>;
			const key = store?.[providerId]?.key;
			if (key) return { apiKey: key, source: "auth.json" };
		} catch (error) {
			log(`auth(auth.json) 失败: ${describe(error)}`);
		}

		return { source: "none" };
	}

	async function fetchBalance(ctx: any): Promise<void> {
		const providerId: string | undefined = ctx?.model?.provider;
		if (!providerId) return;

		const adapter = resolveAdapter(providerId, config.providers);
		if (!adapter) {
			// 该 provider 没有余额接口（free-opencode / free-nvidia 属此类）：清掉角标，别显示陈旧的别的 provider 的数
			if (cached && cached.provider !== providerId) {
				cached = undefined;
				try {
					ctx.ui?.setStatus?.(config.statusKey, undefined);
				} catch {
					/* ignore */
				}
			}
			log(`provider=${providerId} 无余额适配器，跳过`);
			return;
		}

		const auth = await resolveAuth(ctx, providerId);
		if (!auth.apiKey) {
			log(`provider=${providerId} 拿不到 apiKey（source=${auth.source}）`);
			return;
		}

		const url = expandUrl(adapter, auth.baseUrl);
		const headers: Record<string, string> = {
			Accept: "application/json",
			"User-Agent": "pi-tui-suite/balance",
			...(auth.apiKey ? { Authorization: `Bearer ${auth.apiKey}` } : {}),
			...(auth.headers ?? {}),
		};

		const response = await fetch(url, { headers, signal: AbortSignal.timeout(config.timeoutMs) });
		if (!response.ok) {
			throw new Error(`HTTP ${response.status} ${(await response.text().catch(() => "")).slice(0, 120)}`);
		}

		const result = parseBalancePayload(adapter.kind, await response.json(), adapter.symbol);
		const text = formatStatusText(result, config.label);
		cached = { text, result, provider: providerId, at: Date.now(), url };

		try {
			ctx.ui?.setStatus?.(config.statusKey, text);
		} catch (error) {
			log(`setStatus 失败: ${describe(error)}`);
		}
		log(`provider=${providerId} kind=${adapter.kind} url=${url} auth=${auth.source} → ${text}`);
	}

	/** 统一的刷新入口：inflight 去重 + TTL 判断；内部吞掉所有异常。 */
	function refresh(ctx: any, options: { force?: boolean } = {}): Promise<void> {
		if (process.env.PI_OFFLINE) return Promise.resolve();
		if (ctx?.mode === "print" || ctx?.mode === "json") return Promise.resolve();

		const providerId: string | undefined = ctx?.model?.provider;
		const ttlMs = config.refreshMinutes * 60_000;
		if (!options.force && cached && cached.provider === providerId && Date.now() - cached.at < ttlMs) {
			return Promise.resolve();
		}
		if (inflight) return inflight;

		inflight = (async () => {
			try {
				await fetchBalance(ctx);
			} catch (error) {
				log(`刷新失败: ${describe(error)}`);
			} finally {
				inflight = undefined;
			}
		})();
		return inflight;
	}

	pi.on("session_start", (_event: unknown, ctx: any) => {
		void refresh(ctx, { force: true });
	});

	pi.on("model_select", (_event: unknown, ctx: any) => {
		void refresh(ctx, { force: true });
	});

	pi.on("turn_end", (_event: unknown, ctx: any) => {
		void refresh(ctx); // TTL 内直接返回，避免每次回合都打网络
	});

	pi.registerCommand("balance", {
		description: "刷新并显示当前 provider 的账户余额（footer 角标同源）",
			handler: async (_args: string, ctx: any) => {
			try {
				await refresh(ctx, { force: true });
			} catch (error) {
				log(`/balance 强制刷新失败: ${describe(error)}`);
			}
			const providerId = ctx?.model?.provider ?? "(未知)";
			// 只展示**当前 provider** 的数据：切了模型但新 provider 没适配器时，
			// 不能把上一个 provider 的余额当成当前值报出去。
			if (cached && cached.provider === providerId) {
				ctx.ui?.notify?.(
					[
						`${cached.provider} → ${cached.text}`,
						cached.result.detail,
						`接口 ${cached.url}`,
						`更新于 ${new Date(cached.at).toLocaleTimeString()}`,
					].join("\n"),
					"info",
				);
				return;
			}
			const adapter = resolveAdapter(providerId, config.providers);
			const stale = cached ? `（上一次成功的是 ${cached.provider} → ${cached.text}）` : "";
			ctx.ui?.notify?.(
				adapter
					? `${providerId}: 取数失败，看 $PI_TUI_SUITE_LOG 或日志文件${stale}`
					: `${providerId}: 没有余额接口（典型：免费额度 provider）${stale}`,
				"warning",
			);
		},
	});
}

function describe(error: unknown): string {
	if (error instanceof Error) {
		const cause = error.cause instanceof Error ? ` (cause: ${error.cause.message})` : "";
		return `${error.name}: ${error.message}${cause}`;
	}
	return String(error);
}
