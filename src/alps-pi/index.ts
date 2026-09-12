/**
 * alps-pi（vendored 装配层）
 *
 * 代码本体在 `vendor/alps-pi@0.3.3/`，原样来自 npm 包，**只带两处登记过的本地补丁**
 * （见仓库根 PATCHES.md）：
 *   1. `src/features/chrome-frame/patch.ts` —— chromeFrame 早退缓存（长会话/流式卡顿主项的修复）
 *   2. `src/features/bottom-input/{status,frame}.ts` —— 把 `balance` 扩展状态内嵌到
 *      输入框上边框、紧跟在上下文进度条后面
 *
 * 上游升级：`tools/sync-upstream.sh --check alps-pi` 看差异 → `--update` 抽新版本 →
 * 按 PATCHES.md 重新打这两处补丁 → 改这里的 import 版本号 → `/reload`。
 */

import alpsPi from "../../vendor/alps-pi@0.3.3/index.ts";

export function installAlpsPi(pi: any): void {
	alpsPi(pi);
}
