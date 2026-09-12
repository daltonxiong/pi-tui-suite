/**
 * preview-frame.mjs —— 离线预览输入框线框布局（不用开手机就能看效果）
 *
 * 用途：`renderBeautifiedEditorFrame()` 是纯函数，直接喂假主题 + 假状态就能看它在各宽度下
 * 画成什么样。改底栏布局（比如"窄屏把模型名/余额提到上一行"）时用它验证，比反复 /reload 快得多。
 *
 * 用法：
 *   node tools/preview-frame.mjs
 *   node tools/preview-frame.mjs 48 80 120     # 指定要预览的宽度
 */

const widths = process.argv.slice(2).map(Number).filter((n) => Number.isFinite(n) && n > 0);
const targets = widths.length > 0 ? widths : [48, 60, 100];

const { createJiti } = await import("jiti");
const jiti = createJiti(import.meta.url, { moduleCache: false });
const { renderBeautifiedEditorFrame } = await jiti.import(
	new URL("../vendor/alps-pi@0.3.3/src/features/bottom-input/frame.ts", import.meta.url).pathname,
);

// 假主题：只保证 fg/bold/bg 存在即可（真渲染里是 pi 的 theme 对象）
const theme = {
	fg: (_token, text) => text,
	bg: (_token, text) => text,
	bold: (text) => text,
	italic: (text) => text,
	underline: (text) => text,
};

const status = {
	model: "deepseek/deepseek-flash",
	thinking: "medium",
	// 进度条就用真字符串（含 no-ANSI）
	context: "▤━━━━━━━╸── 42.3%/128k",
	balance: "¥42.50",
	elapsed: "⏱ 12s",
	sessionUsage: { input: 1234, output: 340, cacheRead: 0, cacheWrite: 0, latestCacheHitRate: 62.5 },
	tokensPerSecond: 18.4,
	inputMetrics: { inputTokens: true, outputTokens: true, cacheHit: true, tokenSpeed: true, elapsedTime: true },
};

for (const width of targets) {
	const lines = renderBeautifiedEditorFrame({
		editorLines: ["> 帮我改一下这个函数"],
		width,
		theme,
		status,
	});
	console.log(`\n──────── width = ${width} ────────`);
	for (const [index, line] of lines.entries()) {
		const shown = line.replace(/\x1b\[[0-9;]*m/g, ""); // 去色便于肉眼看
		console.log(`${String(index).padStart(2)} |${shown}|`);
	}
}
console.log("\n说明：窄屏（放不下时）第 0 行是「模型名 + 余额」，第 1 行才是带进度条的边框行。");
