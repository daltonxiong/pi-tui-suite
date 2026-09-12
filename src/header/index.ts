/**
 * 顶部 header（vendored 装配层）
 *
 * 只搬了 pi-open-tui 里**唯一还活着**的部分：`header.ts`（244 行）+ 它依赖的 `utils.ts`（381 行）。
 * 其余 2,000+ 行（footer.ts / editor.ts / peek.ts / fullscreen-scroll.ts / telemetry.ts /
 * git.ts / settings-command.ts）在这个组合里从未生效 —— footer 与 editor 的 slot 被 alps-pi 抢走，
 * 而 peek / fullscreen-scroll 又只挂在 editor 那条死路径上。
 *
 * header 是静态的（`invalidate(): void {}`，无计时器），所以它几乎不花每帧成本，
 * 保留与否纯粹是观感选择：想要顶部 logo 就开，省一行屏幕高度就关（config 里 `header.enabled`）。
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { installHeader as installVendoredHeader } from "../../vendor/pi-open-tui@0.3.5/extensions/open-tui/header.ts";

/** 安装顶部 header；返回清理函数（卸载时恢复 pi 默认）。 */
export function installHeader(pi: ExtensionAPI, ctx: ExtensionContext): () => void {
	return installVendoredHeader(pi, ctx);
}
