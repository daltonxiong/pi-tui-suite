/**
 * render-readme-screen.mjs —— 生成 README 里那张「Android / Termux 手机端全屏示例」
 *
 * 为什么要脚本生成：整屏示例里的头部、消息线框、输入框、底部状态行全部**调用真实渲染函数**
 * （vendor 里的 header / renderNeonBox / renderBottomInputStatus / renderBeautifiedEditorFrame），
 * 所以它不是手画的示意图 —— 改了补丁或布局，重跑 `node tools/render-readme-screen.mjs`
 * 就能拿到与真机一致的输出（Termux 两排虚拟键是照 ~/.termux/termux.properties 的布局画的）。
 *
 * 用法：
 *   node tools/render-readme-screen.mjs            # 打印到 stdout（48 列 × 25 行）
 *   node tools/render-readme-screen.mjs --write    # 写入 README.md 的 <!-- screen:start/end --> 之间
 */

import { readFileSync, writeFileSync } from "node:fs";

const WIDTH = 48;
const ROWS = 43;   // 软键盘收起时的终端高度（展开时会缩到 25 行，见 README 说明）

const { createJiti } = await import("jiti");
const jiti = createJiti(import.meta.url, { moduleCache: false });
const base = new URL("../vendor/alps-pi@0.3.3/src/features/", import.meta.url).pathname;
const chrome = await jiti.import(`${base}chrome-frame/chrome.ts`);
const statusMod = await jiti.import(`${base}bottom-input/status.ts`);
const frameMod = await jiti.import(`${base}bottom-input/frame.ts`);
const { OpenTuiHeader } = await jiti.import(
	new URL("../vendor/pi-open-tui@0.3.5/extensions/open-tui/header.ts", import.meta.url).pathname,
);

const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const theme = {
	name: "dracula",
	fg: (_t, text) => String(text),
	bg: (_t, text) => String(text),
	bold: (t) => String(t),
	italic: (t) => String(t),
	underline: (t) => String(t),
	inverse: (t) => String(t),
};

// ── 顶部 header（真实渲染）────────────────────────────────────────────────
const fakePi = {
	getCommands: () => ["model", "compact", "new", "reload", "thinking", "balance"].map((name) => ({ name })),
	getThinkingLevel: () => "medium",
};
const fakeCtx = {
	ui: { theme },
	model: { provider: "deepseek", id: "deepseek-flash", name: "deepseek-flash", contextWindow: 128000 },
	cwd: "/home/user/my-project",
	getThinkingLevel: () => "medium",
	getContextUsage: () => ({ tokens: 58000, contextWindow: 128000, percent: 45.3 }),
	sessionManager: {
		getEntries: () => [
			{ type: "message", message: { role: "assistant", usage: { input: 1234, output: 340, cacheRead: 7200, cacheWrite: 40 } } },
			{ type: "message", message: { role: "assistant", usage: { input: 900, output: 260, cacheRead: 9800, cacheWrite: 0 } } },
		],
	},
};
const headerLines = new OpenTuiHeader(fakePi, fakeCtx, {}).render(WIDTH).map(strip);

// ── 对话区（真实线框）────────────────────────────────────────────────────
const box = (kind, lines, options = {}) => chrome.renderNeonBox(kind, lines, WIDTH, theme, options).map(strip);
const transcriptBoxes = [
	box("user", ["把 src/api.ts 里的重试逻辑抽成函数"]),
	box("assistant", ["好的，我看一下文件结构。"]),
	box("toolSuccess", ["$ ls src", "api.ts  cache.ts  index.ts"], { toolName: "bash" }),
	box("thinking", ["现在把重试逻辑独立出来…"]),
	box("assistant", ["已将重试逻辑抽成 `withRetry()`，默认 3 次退避重试。"]),
	box("user", ["顺便给它加个超时参数"]),
	box("toolSuccess", ["$ npm test", "  ✓ 12 passed"], { toolName: "bash" }),
	box("assistant", ["已加上 `timeoutMs` 参数，默认 10s。"]),
];

// ── 输入框 + 底部状态（真实渲染）──────────────────────────────────────────
const now = Date.now();
const layout = statusMod.renderBottomInputStatus({
	ctx: fakeCtx,
	footerData: { getExtensionStatuses: () => new Map([["balance", "¥42.50"]]) },
	theme,
	width: WIDTH,
	beautifiedInputEnabled: true,
	isStreaming: false,
	liveUsage: null,
	latestAssistantUsage: null,
	currentThinkingLevel: "medium",
	tokensPerSecond: 18.4,
	sessionStartTime: now - 72_000,
	now,
	lastPrompt: "把 src/api.ts 里的重试逻辑抽成函数",
	inputMetrics: { inputTokens: true, outputTokens: true, cacheHit: true, tokenSpeed: true, elapsedTime: true },
});
const dock = [
	...frameMod.renderBeautifiedEditorFrame({
		editorLines: ["> 帮我加个超时参数"],
		width: WIDTH,
		theme,
		status: layout.frameStatus,
	}),
	...layout.secondaryLines,
	...layout.lastPromptLines,
].map(strip);

// ── Termux 两排虚拟键（按 ~/.termux/termux.properties 的布局画）──────────────
const keyRow = (labels) => {
	const gap = 2;
	const total = labels.reduce((sum, label) => sum + label.length, 0) + gap * (labels.length - 1);
	const pad = Math.max(0, Math.floor((WIDTH - 2 - total) / 2));
	const line = labels.join(" ".repeat(gap));
	return `│${" ".repeat(pad)}${line}${" ".repeat(Math.max(0, WIDTH - 2 - pad - line.length))}│`;
};
const keys = [
	"┌" + "─".repeat(WIDTH - 2) + "┐",
	keyRow(["ESC", "☰", "HOME", "↑", "END", "PGUP", "↲"]),
	keyRow(["↹", "CTRL", "←", "↓", "→", "PGDN", "⌨"]),
	"└" + "─".repeat(WIDTH - 2) + "┘",
];

// ── 拼成整屏：header（固定）+ 对话（底部对齐）+ 输入框/状态 + 虚拟键（固定）────
const transcriptBudget = Math.max(0, ROWS - headerLines.length - dock.length - keys.length);
// 只保留能完整放下的**整个**线框（从最新往回放），避免切出半个框
const body = [];
for (let i = transcriptBoxes.length - 1; i >= 0; i -= 1) {
	const candidate = transcriptBoxes[i];
	if (candidate.length + body.length > transcriptBudget) break;
	body.unshift(...candidate);
}
const filler = Array.from({ length: Math.max(0, transcriptBudget - body.length) }, () => "");
const screen = [...headerLines, ...filler, ...body, ...dock, ...keys];

const rendered = screen
	.slice(0, ROWS)
	.map((line) => strip(line).slice(0, WIDTH).replace(/\s+$/, ""))
	.join("\n");
const banner = `Android / Termux · 终端 ${WIDTH} 列 × ${ROWS} 行（软键盘收起；展开时缩到 25 行）`;

const block = [
	`<!-- screen:start -->`,
	"```",
	rendered,
	"```",
	`<!-- screen:end -->`,
].join("\n");

if (process.argv.includes("--write")) {
	const readmePath = new URL("../README.md", import.meta.url).pathname;
	const readme = readFileSync(readmePath, "utf8");
	if (!readme.includes("<!-- screen:start -->")) {
		console.error("README 里找不到 <!-- screen:start --> 标记，先手动加上再跑 --write");
		process.exit(1);
	}
	writeFileSync(readmePath, readme.replace(/<!-- screen:start -->[\s\S]*?<!-- screen:end -->/, block));
	console.log(`已写入 README.md（${banner}）`);
} else {
	console.log(banner);
	console.log(rendered);
}
