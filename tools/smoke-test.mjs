/**
 * 冒烟测试 —— 用 pi 自己的 TS 加载器（jiti）把整个模块图跑一遍
 *
 * 为什么不用 `node --experimental-strip-types`：它只做"类型剥离"，遇到
 * TS 参数属性（`constructor(private readonly x: T)`，vendored 的 pi-rounded-tools 里就有）
 * 会直接报 ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX；而 pi 用的是 jiti（真正转译）。
 *
 * 用法（在仓库根）：
 *   node tools/smoke-test.mjs
 *
 * 它检查：① 所有模块能 import（语法/引用/依赖解析）；② 装配入口干跑不抛；
 *       ③ 打印注册的事件与命令。
 * 注意：真正的渲染路径（chromeFrame 早退缓存、余额内嵌上边框）只有 pi 真渲染时才会走到，
 *       这个脚本覆盖不到 —— 那部分靠 /reload 后肉眼核对。
 *
 * 依赖 node_modules 里的软链（jiti / @earendil-works/*），由 tools/link-dev-deps.sh 创建。
 */

const entryPath = new URL("../extensions/pi-tui-suite.ts", import.meta.url).pathname;

const { createJiti } = await import("jiti");
const jiti = createJiti(import.meta.url, { moduleCache: false });

const mod = await jiti.import(entryPath);
const entry = mod.default ?? mod;
if (typeof entry !== "function") {
	console.error("✗ 入口没有 default 导出函数");
	process.exit(1);
}
console.log("✓ 模块图 import 通过，入口 default 是函数");

const handlers = new Map();
const commands = [];
const pi = {
	on(name, fn) {
		if (!handlers.has(name)) handlers.set(name, []);
		handlers.get(name).push(fn);
	},
	registerCommand(name) {
		commands.push(name);
	},
	registerTool() {},
	registerProvider() {},
	appendEntry() {},
	getCommands: () => [],
	getThinkingLevel: () => "medium",
};

entry(pi);
console.log(`✓ 装配干跑通过：注册事件 ${[...handlers.keys()].sort().join(", ")}`);
console.log(`✓ 注册命令 ${commands.length ? commands.join(", ") : "(无)"}`);

// 回归：provider id 归一化匹配 —— Windows 上 cc-switch 的 "cc-switch-deep-seek"
// 去分隔符后必须命中内置 deepseek，否则余额角标不显示。
const adaptersUrl = new URL("../src/balance/adapters.ts", import.meta.url).pathname;
const adapters = await jiti.import(adaptersUrl);
const overrides = {
	"cc-switch-open-router": { url: "https://openrouter.ai/api/v1/credits", kind: "openrouter-credits", symbol: "$" },
};
const cases = [
	["cc-switch-deep-seek", "deepseek"],
	["cc_switch_deep.seek", "deepseek"],
	["deepseek", "deepseek"],
	["cc-switch-open-router", "openrouter-credits"],
];
for (const [id, kind] of cases) {
	const adapter = adapters.resolveAdapter(id, overrides);
	if (!adapter || adapter.kind !== kind) {
		console.error(`✗ resolveAdapter(${id}) => ${adapter ? adapter.kind : "undefined"}，期望 ${kind}`);
		process.exit(1);
	}
}
console.log("✓ 余额适配器匹配（大小写/分隔符归一化）通过");

// 回归：Windows 右击粘贴去重 —— Orca/VS Code 终端自带粘贴，pi 的合成粘贴必须让位；
// 其它终端（Windows Terminal 等）必须保持原行为，否则会彻底失去右击粘贴。
const rcPasteUrl = new URL("../src/right-click-paste/index.ts", import.meta.url).pathname;
const rcPaste = await jiti.import(rcPasteUrl);
const skipCases = [
	["Orca", ["vscode", "orca"], true],
	["ORCA", ["vscode", "orca"], true],
	["vscode", ["vscode", "orca"], true],
	["Windows_Terminal", ["vscode", "orca"], false],
	[undefined, ["vscode", "orca"], false],
	["orca", [], false],
];
for (const [term, list, expected] of skipCases) {
	const actual = rcPaste.shouldSkipSyntheticRightClickPaste(term, list);
	if (actual !== expected) {
		console.error(`✗ shouldSkipSyntheticRightClickPaste(${term}, ${JSON.stringify(list)}) => ${actual}，期望 ${expected}`);
		process.exit(1);
	}
}
if (process.platform === "win32") {
	const { TuiAltScreen } = await import("@earendil-works/pi-tui");
	rcPaste.installRightClickPasteGuard(true, ["vscode", "orca"], () => {});
	const previousTerm = process.env.TERM_PROGRAM;
	let fired = 0;
	const fakeThis = { onRightClickPaste: () => { fired++; } };
	try {
		process.env.TERM_PROGRAM = "Orca";
		const consumedUnderOrca = TuiAltScreen.prototype.handleRightClickPaste.call(fakeThis, { release: false, button: 2 });
		process.env.TERM_PROGRAM = "Windows_Terminal";
		const consumedUnderWt = TuiAltScreen.prototype.handleRightClickPaste.call(fakeThis, { release: false, button: 2 });
		if (consumedUnderOrca !== false || fired !== 1 || consumedUnderWt !== true) {
			console.error(`✗ 右击粘贴去重补丁行为异常：orca consumed=${consumedUnderOrca} fired=${fired} wt consumed=${consumedUnderWt}`);
			process.exit(1);
		}
	} finally {
		if (previousTerm === undefined) delete process.env.TERM_PROGRAM;
		else process.env.TERM_PROGRAM = previousTerm;
	}
}
console.log("✓ 右击粘贴去重（Orca 让位 / 其它终端保留）通过");

// 回归：ConPTY 鼠标上报重放 —— Windows/WSL 下 fullscreen 的滚轮与选区复制都依赖它。
// 把平台判定与序列选择写成纯函数，避开真实终端；再断言补丁确实挂在渲染器原型上。
const mouseReportUrl = new URL("../src/mouse-report/index.ts", import.meta.url).pathname;
const mouseReport = await jiti.import(mouseReportUrl);
const platformCases = [
	["win32", {}, true],
	["linux", { WSL_DISTRO_NAME: "Ubuntu-24.04" }, true],
	["linux", {}, false],
	["darwin", {}, false],
	["win32", { PI_TUI_SUITE_MOUSE_REPLAY: "0" }, false],
];
for (const [platform, env, expected] of platformCases) {
	const actual = mouseReport.needsMouseReportReplay(platform, env);
	if (actual !== expected) {
		console.error(`✗ needsMouseReportReplay(${platform}, ${JSON.stringify(env)}) => ${actual}，期望 ${expected}`);
		process.exit(1);
	}
}
const allMotion = mouseReport.mouseReportSequence({});
const buttonMotion = mouseReport.mouseReportSequence({ TMUX: "/tmp/tmux-1000/default" });
if (!allMotion.includes("\x1b[?1003h") || !buttonMotion.includes("\x1b[?1002h") || buttonMotion.includes("\x1b[?1003h")) {
	console.error(`✗ 鼠标上报序列不对：all=${JSON.stringify(allMotion)} button=${JSON.stringify(buttonMotion)}`);
	process.exit(1);
}
const written = [];
const replayed = mouseReport.replayMouseReport(
	{ mouseEnabled: true, terminal: { write: (data) => written.push(data) } },
	{},
);
const skipped = mouseReport.replayMouseReport(
	{ mouseEnabled: false, terminal: { write: (data) => written.push(data) } },
	{},
);
if (!replayed || replayed !== written[0] || skipped !== undefined || written.length !== 1) {
	console.error(`✗ replayMouseReport 行为异常：replayed=${replayed} skipped=${skipped} writes=${written.length}`);
	process.exit(1);
}
if (mouseReport.needsMouseReportReplay() && !mouseReport.isMouseReportPatched()) {
	console.error("✗ 当前平台需要鼠标重放，但 TuiAltScreen.prototype 上没有补丁");
	process.exit(1);
}
console.log("✓ ConPTY 鼠标上报重放（平台判定 / 序列 / 补丁挂载）通过");

// 回归：上下文危险区阈值 —— pi 把 max_tokens 报成 min(model.maxTokens, 窗口 - 估算 - 4096)，
// provider 把 prompt 与 completion 记在同一个窗口。输出上限越大，可用输入越少；越过
// 「窗口 - maxTokens - 4096」后请求只剩 4096 的估算误差余量，随时 400。
// 下面的数字取自真实喷掉的一次会话：1M 窗口、maxTokens 393216、最后一条 usage 707144。
const statusUrl = new URL("../vendor/alps-pi@0.3.3/src/features/bottom-input/status.ts", import.meta.url).pathname;
const statusMod = await jiti.import(statusUrl);
const thresholdCases = [
	[{ tokens: 707144, contextWindow: 1048576, maxTokens: 393216 }, { errorAt: 62.109375, saturated: true }],
	[{ tokens: 707144, contextWindow: 1048576, maxTokens: 65536 }, { errorAt: 90, saturated: false }],
	[{ tokens: 707144, contextWindow: 1048576 }, { errorAt: 90, saturated: false }],
	[{ tokens: 42000, contextWindow: 128000, maxTokens: 4096 }, { errorAt: 90, saturated: false }],
];
for (const [usage, expected] of thresholdCases) {
	const actual = statusMod.contextThresholds(usage);
	if (Math.abs(actual.errorAt - expected.errorAt) > 1e-9 || actual.saturated !== expected.saturated) {
		console.error(`✗ contextThresholds(${JSON.stringify(usage)}) => ${JSON.stringify(actual)}，期望 ${JSON.stringify(expected)}`);
		process.exit(1);
	}
}
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const theme = { fg: (_token, text) => text, bg: (_token, text) => text, bold: (t) => t, italic: (t) => t, underline: (t) => t };
const overflowFrame = statusMod.renderFrameStatus(
	{
		ctx: { model: { provider: "deepseek", name: "deepseek-flash", contextWindow: 1048576, maxTokens: 393216 }, getThinkingLevel: () => "max" },
		theme,
		width: 100,
		beautifiedInputEnabled: true,
		isStreaming: false,
		liveUsage: null,
		latestAssistantUsage: null,
		currentThinkingLevel: "max",
		sessionStartTime: 0,
		now: 0,
		lastPrompt: "",
	},
	"deepseek/deepseek-flash",
	"max",
	{ tokens: 707144, contextWindow: 1048576, maxTokens: 393216, percent: 67.4 },
);
if (!stripAnsi(overflowFrame.context ?? "").includes("67.4%/1.0M!")) {
	console.error(`✗ 越过输入预算后没有警示标：${JSON.stringify(stripAnsi(overflowFrame.context ?? ""))}`);
	process.exit(1);
}
// error 色 #ff5f5f 必须真的落到这一段（只看文本会漏掉「颜色没跟着变」的回归）
if (!(overflowFrame.context ?? "").includes("\x1b[38;2;255;95;95m")) {
	console.error(`✗ 越过输入预算后没有转成错误色：${JSON.stringify(overflowFrame.context)}`);
	process.exit(1);
}
const normalFrame = statusMod.renderFrameStatus(
	{
		ctx: { model: { provider: "deepseek", name: "deepseek-flash", contextWindow: 1048576, maxTokens: 65536 }, getThinkingLevel: () => "max" },
		theme,
		width: 100,
		beautifiedInputEnabled: true,
		isStreaming: false,
		liveUsage: null,
		latestAssistantUsage: null,
		currentThinkingLevel: "max",
		sessionStartTime: 0,
		now: 0,
		lastPrompt: "",
	},
	"deepseek/deepseek-flash",
	"max",
	{ tokens: 707144, contextWindow: 1048576, maxTokens: 65536, percent: 67.4 },
);
if (stripAnsi(normalFrame.context ?? "").includes("!") || !stripAnsi(normalFrame.context ?? "").includes("67.4%/1.0M")) {
	console.error(`✗ 输出上限较小时的显示不对：${JSON.stringify(stripAnsi(normalFrame.context ?? ""))}`);
	process.exit(1);
}
console.log("✓ 上下文危险区阈值（输入预算 / 警示标 / 错误色）通过");

console.log("\n冒烟全部通过。");
