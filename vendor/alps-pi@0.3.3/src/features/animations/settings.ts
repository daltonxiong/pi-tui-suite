/** 功能：定义内置 Animations 配置与归一化规则。 实现者：alps 实现日期：2026-05-29 */

import type { AnimationWidth } from "./registry.ts";
import { getAnimation } from "./registry.ts";

export type AnimationsSettings = {
	/** 是否启用底部 working/thinking/tool 与 hidden thinking 动画替换。 */
	enabled: boolean;
	/** 是否每次 agent 回合随机挑选同分类动画。 */
	randomMode: boolean;
	/** working 动画名；用于接管底部 Working... 状态。 */
	working: string;
	/** thinking 动画名；用于底部 thinking phase 与 hidden thinking label。 */
	thinking: string;
	/** tool 动画名；用于 tool 执行期底部动画。 */
	tool: string;
	/** 动画渲染宽度。 */
	width: AnimationWidth;
	/** 动画刷新帧率。 */
	fps: number;
};

export const DEFAULT_ANIMATIONS_SETTINGS: AnimationsSettings = {
	enabled: true,
	randomMode: false,
	working: "crush",
	thinking: "shimmer",
	tool: "pipeline",
	width: "default",
	fps: 4, // LOCAL PATCH (pi-tui-suite)：默认 4（上游 16），见 ANIMATION_FPS_VALUES 上方注释
};

export const ANIMATION_WIDTH_VALUES: AnimationWidth[] = ["full", "default", 20, 40, 60, 80];
// ── LOCAL PATCH (pi-tui-suite)：低帧率选项 + 默认 4 ─────────────────────────
// 上游只允许 [8,12,16,24,30]，而 readFps() 对不在列表里的值是**静默回落默认值**
// （写 fps: 4 会变成 16，且 alps-pi 持久化时会把 16 写回 settings.json）。
// 实测：16 fps 动画在跑工具期间让 pi 持续 ~100–114% CPU（单帧 ~62ms，见 ERR-013），
// 4 fps 则约 25%。这里补上低档位并把默认值调成 4。
export const ANIMATION_FPS_VALUES = [2, 4, 6, 8, 12, 16, 24, 30] as const;

export function cloneDefaultAnimationsSettings(): AnimationsSettings {
	return { ...DEFAULT_ANIMATIONS_SETTINGS };
}

export function normalizeAnimationsSettings(value: unknown, defaults: AnimationsSettings = DEFAULT_ANIMATIONS_SETTINGS): AnimationsSettings {
	const raw = isRecord(value) ? value : {};
	return {
		enabled: readBoolean(raw, "enabled", defaults.enabled),
		randomMode: readBoolean(raw, "randomMode", defaults.randomMode),
		working: readAnimationName(raw.working, defaults.working),
		thinking: readAnimationName(raw.thinking, defaults.thinking),
		tool: readAnimationName(raw.tool, defaults.tool),
		width: readWidth(raw.width, defaults.width),
		fps: readFps(raw.fps, defaults.fps),
	};
}

function readBoolean(parent: Record<string, unknown>, key: string, fallback: boolean): boolean {
	return typeof parent[key] === "boolean" ? parent[key] : fallback;
}

function readAnimationName(value: unknown, fallback: string): string {
	if (typeof value !== "string") return fallback;
	return getAnimation(value) ? value : fallback;
}

function readWidth(value: unknown, fallback: AnimationWidth): AnimationWidth {
	if (value === "full" || value === "default") return value;
	const numeric = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
	if (!Number.isFinite(numeric)) return fallback;
	const matched = ANIMATION_WIDTH_VALUES.find((item) => item === numeric);
	return matched ?? fallback;
}

function readFps(value: unknown, fallback: number): number {
	const numeric = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
	return (ANIMATION_FPS_VALUES as readonly number[]).includes(numeric) ? numeric : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
