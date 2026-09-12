/**
 * audit-bottom-layout.mjs —— 逐项审计底部区域（输入框 + footer）在各宽度下"显示了什么、丢了什么"
 *
 * 为什么需要：底部区域有四套来源，各自都有宽度裁剪逻辑，窄屏下丢哪个全靠代码推：
 *   1) 输入框上边框：model · thinking（左）  |  上下文进度条 + %/window（+余额）（右）
 *   2) 输入框下边框：input/output/cache/speed/elapsed 五个指标，放不下时按
 *      `[null, "cache", "output", "input", "speed"]` 的顺序**依次丢**（见 frame.ts buildBottomRightLabel）
 *   3) footer（输入框下方）：扩展状态行（` › ` 连接）+ 上一条问题行
 *   4) pi 自己的 widget（above/below editor）、pendingMessages、status —— 不归 alps-pi 管
 *
 * 用法：
 *   node tools/audit-bottom-layout.mjs            # 默认 48 / 60 / 80 / 120 列
 *   node tools/audit-bottom-layout.mjs 48 100
 *
 * 输出：每个宽度下渲染出的行 + 一张「元素 × 可见性」表（✓ 显示 / ✗ 被裁掉）。
 */

const argv = process.argv.slice(2).map(Number).filter((n) => Number.isFinite(n) && n > 0);
const widths = argv.length > 0 ? argv : [48, 60, 80, 120];

const { createJiti } = await import("jiti");
const jiti = createJiti(import.meta.url, { moduleCache: false });
const statusMod = await jiti.import(
	new URL("../vendor/alps-pi@0.3.3/src/features/bottom-input/status.ts", import.meta.url).pathname,
);
const frameMod = await jiti.import(
	new URL("../vendor/alps-pi@0.3.3/src/features/bottom-input/frame.ts", import.meta.url).pathname,
);

const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");

const theme = {
	fg: (_t, text) => text,
	bg: (_t, text) => text,
	bold: (t) => t,
	italic: (t) => t,
	underline: (t) => t,
};

/** 假 ctx：喂进真实数字，让所有指标都有内容（真运行时这些来自 pi） */
function makeCtx() {
	const usageEntry = {
		type: "message",
		message: { role: "assistant", usage: { input: 1234, output: 340, cacheRead: 800, cacheWrite: 40 } },
	};
	return {
		model: { provider: "deepseek", id: "deepseek-flash", name: "deepseek-flash", contextWindow: 128000 },
		getContextUsage: () => ({ tokens: 42000, contextWindow: 128000, percent: 32.8 }),
		// 真运行时是 pi 的 SessionManager（alps-pi 读 ctx.sessionManager.getEntries()）
		sessionManager: { getEntries: () => [usageEntry] },
		getBranchEntries: () => [usageEntry],
		getThinkingLevel: () => "medium",
	};
}

const statuses = new Map([
	["mcp-auth", "Authenticating github..."],
	["pi-mono-context", "ctx 32.8%"],
	["balance", "¥16.68"], // 本套件的余额角标（会被内嵌到上边框）
]);

/** 每个元素用什么文本判定"看得见"（现已改为用真实生成片段，见下面的 checks） */

for (const width of widths) {
	const now = Date.now();
	const layout = statusMod.renderBottomInputStatus({		ctx: makeCtx(),
		footerData: { getExtensionStatuses: () => statuses },
		theme,
		width,
		beautifiedInputEnabled: true,
		isStreaming: false,
		liveUsage: null,
		latestAssistantUsage: null,
		currentThinkingLevel: "medium",
		tokensPerSecond: 18.4,
		sessionStartTime: now - 72_000,
		now,
		lastPrompt: "帮我看看这个函数为什么慢",
		inputMetrics: { inputTokens: true, outputTokens: true, cacheHit: true, tokenSpeed: true, elapsedTime: true },
	});
	const frame = frameMod.renderBeautifiedEditorFrame({
		editorLines: ["> 帮我改一下这个函数"],
		width,
		theme,
		status: layout.frameStatus,
	});
	const footer = [...layout.secondaryLines, ...layout.lastPromptLines];
	const plainAll = strip([...frame, ...footer].join("\n"));

	// 用真实生成出来的片段做判定（避免图标集/截断造成假阴性）
	const checks = [
		["模型名 provider/model", strip(layout.frameStatus.model ?? "(空)")],
		["thinking 等级", strip(layout.frameStatus.thinking ?? "(空)")],
		["上下文进度条", "▤"],
		["上下文 %/窗口", "32.8%/128k"],
		["余额", "¥16.68"],
		["下边框:输入 token", "1.2k"],
		["下边框:输出 token", "340"],
		["上边框:cache 命中率", "38.6%"],
		["下边框:token 速度", "18.4tok/s"],
		["下边框:耗时", "12s"],
		["footer:扩展状态行(mcp-auth)", "Authenticating"],
		["footer:上一条问题", "↳"],
	];

	console.log(`\n${"═".repeat(20)} width = ${width} ${"═".repeat(20)}`);
	for (const line of [...frame, ...footer]) console.log(`  |${strip(line)}|`);

	const missing = [];
	console.log("  元素可见性：");
	for (const [name, needle] of checks) {
		const ok = needle !== "(空)" && plainAll.includes(needle);
		if (!ok) missing.push(name);
		console.log(`    ${ok ? "✓" : "✗"} ${name}`);
	}
	if (missing.length > 0) console.log(`  ⇒ 被裁掉：${missing.join("、")}`);
	else console.log("  ⇒ 全部显示");
}
console.log("\n说明：cache 命中率已移到上边框（上下文进度条前面），所以窄屏也不会被裁；");
console.log("     下边框其余指标按 output → input → speed 的顺序依次被丢（elapsed 最后，上游固定顺序）；");
console.log("     footer 的扩展状态行只在有扩展状态时出现，上一条问题行只在有历史输入时出现。");
