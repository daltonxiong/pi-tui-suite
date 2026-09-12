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
console.log("\n冒烟全部通过。");
