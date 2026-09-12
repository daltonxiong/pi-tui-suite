/**
 * pi-tui-suite —— 本地 TUI 套件（装配入口，pi 从这里加载）
 *
 * 目标：把原来由三个互相抢 slot 的第三方插件拼出来的 TUI 观感，收敛成**一个**可自管、
 * 可 git 追溯、可逐步替换的本地套件。盘点/成本模型/切换与回滚步骤见仓库根 README.md。
 *
 * 装配顺序有意义：
 *   1. alps-pi（vendored）：它注册 chromeFrame 组件补丁、固定输入框（editor）、footer、
 *      动画与 /alps-pi 命令。**必须最先装**，因为后面两个模块都要在它铺好的底子上工作
 *      （余额角标内嵌的是它输入框的上边框；header 是独立 slot）。
 *   2. 余额角标：只往 footer 状态里写一个字符串，走 ctx.ui.setStatus。
 *   3. 圆角工具框（默认关）：开了就是「alps-pi 外框 + 圆角内框」两层。
 *   4. 顶部 header（来自 pi-open-tui 的 header.ts + utils.ts）。
 *
 * 与第三方 npm 包的关系：本套件接管后，settings.json 里原来那三个包应改成
 * `{ "source": "npm:xxx", "extensions": [] }`（停用但不卸载，一条命令即可回滚）。
 *
 * 加载方式：
 *   - pi 配置目录（默认 ~/.pi/agent）的 settings.json 里，把本包目录加进 packages
 *   - 或临时试用：pi -e <本仓库路径>/extensions/pi-tui-suite.ts
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import roundedTools from "../vendor/pi-rounded-tools@0.1.3/extensions/rounded-tools.ts";
import { applyAnimationsFps, installAlpsPi } from "../src/alps-pi/index.ts";
import { installBalanceStatus } from "../src/balance/index.ts";
import { loadSuiteConfig } from "../src/config.ts";
import { installCopyClean } from "../src/copy-clean/index.ts";
import { installHeader } from "../src/header/index.ts";
import { startAutoProfiler } from "../src/perf/profile.ts";
import { installRenderProbe } from "../src/perf/probe.ts";
import { createLogger } from "../src/log.ts";

export default function (pi: ExtensionAPI): void {
	const config = loadSuiteConfig();
	const log = createLogger(config.log);

	log(
		`loaded (alpsPi=${config.alpsPi.enabled ? "on" : "off"} header=${config.header.enabled ? "on" : "off"} ` +
			`roundedFrames=${config.roundedFrames.enabled ? "on" : "off"} balance=${config.balance.enabled ? "on" : "off"})`,
	);

	// 0) 渲染探针（默认关闭；排查卡顿/掉帧时打开，见 README「开发辅助」）
	if (config.probe.enabled) {
		installRenderProbe(pi, config.probe, log);
	}
	if (config.profile.enabled) {
		startAutoProfiler(pi, config.profile, log);
	}

	// 1) alps-pi：线框 + 输入框 + footer + 动画（含本地补丁）
	if (config.alpsPi.enabled) {
		installAlpsPi(pi);
		// 「后注册的 handler 后执行」：确保在 alps-pi 自己读完持久化设置之后再钉帧率，
		// 否则会被它加载的旧值覆盖（它就是那个把 fps 写回 16 的家伙）。
		if (config.alpsPi.animationsFps !== null) {
			pi.on("session_start", () => {
				applyAnimationsFps(config.alpsPi.animationsFps);
				log(`animations fps 已钉在 ${config.alpsPi.animationsFps}`);
			});
		}
	}

	// 2) 复制净化：选中/复制时剥掉线框装饰（原型补丁，session_shutdown 时还原）
	const uninstallCopyClean = installCopyClean(config.copyClean.enabled, log);
	if (config.copyClean.enabled) {
		pi.on("session_shutdown", () => uninstallCopyClean());
	}

	// 3) 余额角标（默认内嵌在输入框上边框的上下文进度条后面）
	if (config.balance.enabled) {
		installBalanceStatus(pi, config.balance, log);
	}

	// 3) 圆角工具框：默认关（一层框）。开了会与 alps-pi 的框叠成两层。
	if (config.roundedFrames.enabled) {
		roundedTools(pi);
	}

	// 4) 顶部 header（静态 logo；不需要就 config.header.enabled = false，省两行屏幕）
	if (config.header.enabled) {
		pi.on("session_start", (_event: unknown, ctx: any) => {
			if (ctx?.mode !== "tui") return;
			try {
				installHeader(pi, ctx);
			} catch (error) {
				log(`header 安装失败: ${error instanceof Error ? error.message : String(error)}`);
			}
		});
	}
}
