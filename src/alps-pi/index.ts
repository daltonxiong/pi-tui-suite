/**
 * alps-pi（vendored 装配层）
 *
 * 代码本体在 `vendor/alps-pi@0.3.3/`，原样来自 npm 包，只带若干**登记过的本地补丁**
 * （见仓库根 PATCHES.md）。
 *
 * 这里额外做一件事：**把动画帧率钉在套件配置上**。
 * 原因：alps-pi 会在启动时读 `settings.json` 的 `alps-pi.animations.fps`，并在各种事件里把内存里的
 * 整份设置**写回**同一位置；只要有一个「记着旧值」的实例活着（或文件里是旧值），
 * 从外部改 `settings.json` 就一定会被覆盖。所以帧率改由 `pi-tui-suite.json` 的
 * `alpsPi.animationsFps` 决定（默认 4），在 alps-pi 自己读完持久化设置之后再覆盖一次，
 * 并顺手写回 settings.json 保持一致，避免两边打架。
 */

import alpsPi from "../../vendor/alps-pi@0.3.3/index.ts";
import { configureAnimations } from "../../vendor/alps-pi@0.3.3/src/features/animations/index.ts";
import { getGlobalPatchState } from "../../vendor/alps-pi@0.3.3/src/features/chrome-frame/index.ts";
import { writePersistedSettings } from "../../vendor/alps-pi@0.3.3/src/settings-store.ts";

export function installAlpsPi(pi: any): void {
	alpsPi(pi);
}

/**
 * 把动画帧率强制设为 `fps`（`null` = 不干预，交给 `/alps-pi` 面板与 settings.json）。
 *
 * 必须在 alps-pi 自己的 `session_start`（读持久化设置）**之后**调用，
 * 否则会被它随后加载的旧值覆盖 —— 装配处用「后注册的 handler 后执行」来保证顺序。
 */
export function applyAnimationsFps(fps: number | null): void {
	if (fps === null || !Number.isFinite(fps) || fps <= 0) return;
	try {
		const state = getGlobalPatchState();
		const settings = state.config.settings;
		if (settings.animations.fps === fps) return;
		settings.animations.fps = fps;
		configureAnimations({
			...settings.animations,
			enabled: settings.chromeFrame.enabled && settings.animations.enabled,
		});
		writePersistedSettings(settings);
	} catch {
		// 覆盖失败只是帧率不生效，不影响其它功能
	}
}
