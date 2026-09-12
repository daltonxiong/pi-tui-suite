/**
 * pi-tui-suite —— 本地 TUI 套件（装配入口，pi 从这里加载）
 *
 * 为什么要有这个项目：见仓库根目录 README.md
 *   - 目前 TUI 观感由三个互相抢 slot 的第三方插件拼出来（pi-open-tui / pi-rounded-tools / alps-pi），
 *     其中 ~3,000 行是死代码或重复实现；且 alps-pi 的 chromeFrame 没有结果缓存，
 *     是长会话"每帧重渲染整个 transcript"成本的主项（`~/.pi/agent/docs/troubleshooting.md` ERR-013）。
 *   - 本仓库把它们收敛成一个可自管、可 git 追溯、可逐步替换的装配层。
 *
 * 阶段：
 *   阶段 1（已实现）：footer 余额角标 —— 与三个插件零冲突，纯增量。
 *   阶段 2（未开始）：把三个插件的"活着的部分"搬进来（vendor/ + tools/sync-upstream.sh）。
 *
 * 加载方式：
 *   - ~/.pi/agent/settings.json 的 packages 里加 "../../projects/pi-tui-suite"
 *   - 或临时试用：pi -e ~/projects/pi-tui-suite/extensions/pi-tui-suite.ts
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installBalanceStatus } from "../src/balance/index.ts";
import { loadSuiteConfig } from "../src/config.ts";
import { createLogger } from "../src/log.ts";

export default function (pi: ExtensionAPI): void {
	const config = loadSuiteConfig();
	const log = createLogger(config.log);

	log(`loaded (balance=${config.balance.enabled ? "on" : "off"})`);

	// ── 阶段 1：余额角标（footer status）────────────────────────────────
	if (config.balance.enabled) {
		installBalanceStatus(pi, config.balance, log);
	}

	// ── 阶段 2：合并三个第三方插件（尚未实现）────────────────────────────
	// if (config.header.enabled) installHeader(pi, config.header);              // 来自 pi-open-tui
	// if (config.roundedFrames.enabled) installRoundedFrames(pi);               // 来自 pi-rounded-tools
	// installAlpsPi(pi, config.alpsPi);                                        // vendor/alps-pi@<ver>
}
