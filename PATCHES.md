# 本地补丁清单（vendor/ 里被我们改过的地方）

约定：`vendor/` 原则上保持上游原样，**只允许**以下几处改动，且必须登记在这里。
`bash tools/sync-upstream.sh --check <pkg>` 会把所有差异列出来 —— 看到差异就来本文件核对是不是这三处之一。

---

## 1. chromeFrame 早退缓存（性能修复，长会话/流式输出每帧开销的主项）

**文件**：`vendor/alps-pi@0.3.3/src/features/chrome-frame/patch.ts`
**标记**：搜 `LOCAL PATCH` / `LOCAL_RENDER_CACHE_KEY`

**上游问题**：`createWrappedRender` 其实带缓存，但检查位置在昂贵计算**之后**：

```ts
const innerKey = displayedLines.join("\n");          // ← O(字符数) 的 join 已经做完
const cache = instance[RENDER_CACHE_KEY];
if (cache && cache.innerKey === innerKey && ...) ...  // ← 才比对
```

`containsImageLine` / `compactToolLines` / `estimateContextContribution` / `collapsedSignature` 的 join /
`createTimingContentKey` 全在它前面 ⇒ 长会话里等于没有缓存：**单帧 ~62 ms**（1.67 万行 × ~3.7 µs），
`fps=4` 时 25% CPU，流式期间（每 token 触发重渲染）直接 100%。

**我们的改动**（3 处插入）：

1. 新增模块级 `LOCAL_RENDER_CACHE_KEY = Symbol.for("pi-tui-suite.alpsChromeRenderCache.v1")`。
2. 在 `innerLines = asLines(originalRender.call(instance, innerWidth))` **之后立刻**比对缓存：
   键 = 宽度 + `createStyleSignature(...)`（含主题色/状态/配置版本）+ `expanded/hideComponent/argsComplete/`
   `showImages/imageWidthCells/executionStarted/convertedImages.size` + **innerLines 数组引用**
   （pi 组件内容不变时返回同一引用）。命中直接返回上次的行数组，跳过上述全部重算与装箱。
3. 两处写缓存：`if (!visible)` 的早返回分支（空 frame 也要缓存，否则每帧仍付 join 开销）与函数尾。

**安全性**：只缓存 **settled 帧**（`instance.isPartial !== true && status !== "pending"`，
且非 collapsed 聚合、非 unframedAssistal 直出）。活跃帧的耗时文本每秒都在变，缓存会把计时冻住；
settled 帧按上游自己的规则「完成后冻结」，可安全复用。主题切换会改 `createStyleSignature` ⇒ 自动 miss。

---

## 2. 余额角标内嵌到输入框上边框（紧跟上下文进度条）
**文件**：`vendor/alps-pi@0.3.3/src/features/bottom-input/status.ts`、`.../frame.ts`
**标记**：搜 `LOCAL_INLINE_STATUS_KEYS` / `LOCAL PATCH`

**上游行为**：`ctx.ui.setStatus()` 写进来的扩展状态统一走
`renderExtensionStatusLines()`，渲染成输入框**下方**的一行（用 ` › ` 分隔）。

**我们的改动**：

- `status.ts`：新增 `LOCAL_INLINE_STATUS_KEYS = new Set(["balance"])`；把原来只返回值数组的
  `getVisibleExtensionStatuses()` 拆成 `getVisibleExtensionStatusEntries()`（保留 key）+ 原函数包装；
  新增 `pickLocalInlineStatuses()`；`renderBottomInputStatus()` 在**线框启用时**把命中的 key 从下方
  statuses 行里摘掉，并通过新增的 `renderFrameStatus(..., inlineBalance)` 参数传给线框；
  缓存键加入 `inlineStatuses`（否则余额变了不重绘）。
- `BottomInputFrameStatus` 增加可选字段 `balance?: string | null`（用 `theme.fg("muted")` 上色）。
- `frame.ts` 的 `buildTopBorder()`：`rightLabel = joinStyledSegments([status.context, status.balance], " ")`
  ⇒ 变成 `... ▤━━━━╸───── 42.3%/128k ¥42.50 ╮`。
- 线框关闭时（`beautifiedInput.enabled = false`）内嵌没有落点，余额自动回到下方 statuses 行（原行为）。

**取消内嵌**：把 `"balance"` 从 `LOCAL_INLINE_STATUS_KEYS` 删掉即可，其余逻辑不用动。

---

## 3. cache 命中率移到上边框（进度条前面）

**文件**：`vendor/alps-pi@0.3.3/src/features/bottom-input/{status,frame}.ts`
**标记**：搜 `readCacheHitRate` / `buildCacheHitSegment`

**上游行为**：cache 命中率是**下边框**五个指标之一，而 `buildBottomRightLabel()` 的丢弃顺序是
`cache → output → input → speed`（elapsed 最后）⇒ 48 列的手机上**只有它会被裁掉**（实测审计确认）。

**改动**：
- `status.ts`：`renderFrameStatus()` 新增 `cacheHitRate`（可见性条件与上游那段一致：
  `inputMetrics.cacheHit !== false` 且有 cacheRead/cacheWrite、rate 为有限数）。
- `frame.ts`：新增 `buildCacheHitSegment()`（取值/配色复用上游 `cacheMetricColor`）；
  `buildTopBorder()` 的右标签变成 `cache 命中率 / 上下文进度条 / 余额` 三段；
  `shouldStackNarrowStatus()` 把这段也计入宽度预算；
  `buildBottomMetricSegments()` 里原来那段 cache 删除（避免重复）。

**效果**（`node tools/audit-bottom-layout.mjs 48`）：

```
deepseek/deepseek-flash                   ¥42.50
╭ med ───────── ↻ 38.6% ▤━━━╸────── 32.8%/128k ╮
│ > 帮我改一下这个函数                         │
╰────── ↑ 1.2k · ↓ 340 · » 18.4tok/s · ◷ 1m12s ╯
```

## 4. 窄屏（手机）把模型名与余额提到输入框上方单独一行

**文件**：`vendor/alps-pi@0.3.3/src/features/bottom-input/frame.ts`
**标记**：搜 `shouldStackNarrowStatus` / `buildNarrowStatusTopLine`

上游把 `model·thinking` 放上边框左边、`进度条+余额` 放右边；48 列下塞不下时
`buildBorderLine()` 会**先截断右侧** ⇒ 余额看不见。现在改成：放不下（现算：两侧标签宽 +6 > 总宽）时
上一行单独放「模型名（左）… 余额（右）」，边框行只留 thinking + cache + 进度条。
宽度够（宽屏/横屏）时保持上游原样。

## 5. 模型名带 provider 前缀

**文件**：`vendor/alps-pi@0.3.3/src/features/bottom-input/status.ts`
**标记**：搜 `readModelName` / `renderModelSegment`

上游 `normalizeModelName()` 会把 `provider/` 前缀剥掉（只留最后一段）。本地补丁改成显示
`provider/model`（与 pi 自己的写法、与顶部 header 的 `formatModelLabel` 一致），
并在 `renderModelSegment()` 里把 provider 段用弱色（`borderMuted`）、模型主体仍用 `accent`。

## 6. 动画帧率：允许低档位 + 默认 4

**文件**：`vendor/alps-pi@0.3.3/src/features/animations/settings.ts`、`vendor/alps-pi@0.3.3/src/settings.ts`
**标记**：搜 `LOCAL PATCH` / `ANIMATION_FPS_VALUES`

上游 `ANIMATION_FPS_VALUES = [8,12,16,24,30]`，而 `readFps()` 对不在列表里的值是**静默回落默认值**：
写 `fps: 4` 会变成 16，并且 alps-pi 持久化时会把 16 **回写 settings.json**（实测被回写一次）。
实测 16 fps 的动画在跑工具期间让 pi 常驻 **~100–114% CPU**（单帧 ~62ms）。

**改动**（两层，缺一不可）：

1. `ANIMATION_FPS_VALUES` 补上 `2,4,6`；两处默认值 `fps: 16 → 4`。
2. **帧率改由套件配置决定**：`pi-tui-suite.json` 的 `alpsPi.animationsFps`（默认 4），
   在 alps-pi 自己读完持久化设置之后（我们的 `session_start` handler 后注册 ⇒ 后执行）
   通过它自己的 `configureAnimations()` + `writePersistedSettings()` 覆盖并回写。

为什么必须第 2 层：alps-pi 会在启动读 `settings.json` 的 `alps-pi.animations.fps`，并在各种事件里
把**内存里的整份设置写回**同一位置 —— 只要有一个「记着旧值」的实例活着，或文件里是旧值，
从外部改 `settings.json` 必然被覆盖（实测被回写两次）。改成读套件配置后两边不再打架。
设 `alpsPi.animationsFps: null` 可退回「交给 `/alps-pi` 面板 + settings.json」的原始行为。

## 8. 隐藏 pi 自带 spinner（消除双帧源）

**文件**：`vendor/alps-pi@0.3.3/src/features/animations/runtime.ts`
**标记**：搜 `LOCAL PATCH (pi-tui-suite)：统一隐藏 pi 自带的 spinner`

上游按每个动画的 `nativeIndicator`（`show`/`hide`）决定是否保留 pi 原生 spinner。
但原生 spinner 是 **80 ms（12.5 fps）的独立计时器**，与 alps-pi 的动画计时器**同时**跑：
两个帧源叠加时，`animations.fps` 只能省掉一部分 —— 实测（跑工具窗口）`fps=4` 仍占 63% CPU，
而纯 4 fps 应约 25%。

**改动**：`renderWorkingAnimationFrame()` 里把 `shouldHideIndicator` 恒为 `true`
（动画被关闭时该函数提前返回，原生 spinner 照常显示）。

**代价**：动画行不再叠一个转圈图标，只剩动画本身在动（4 fps 下仍看得出在动）。
想要回原来的样子就删掉这一处改动。

## 9. 幂等化 tracked settings（35% CPU 的热点）

**文件**：`vendor/alps-pi@0.3.3/src/features/chrome-frame/patch.ts`
**标记**：搜 `LOCAL PATCH (pi-tui-suite)：已包过就直接返回` / `幂等化`

**上游问题**：`createWrappedRender()` 每帧、每个组件都会调用 `getGlobalPatchState()`，
而它内部**无条件**跑 `ensurePatchStateConfigTracking()` → `createTrackedSettings()` →
`normalizeSettings()`（一大堆对象展开）+ 新建 **8 个 Proxy**（且 Proxy 会层层嵌套，之后每次读字段都穿多层陷阱）。

V8 采样剖分实测（跑工具窗口，10 s / 14166 个采样）：

```
1358.5ms  19.2%  normalizeSettings  @ chrome-frame/patch.ts:424
 752.5ms  10.6%  normalizeSettings  @ 同上            ← 合计 34.8%
 159.0ms   2.2%  alpsChromeWrappedRender @ patch.ts:959
  58.5ms   0.8%  get（Proxy 陷阱）@ patch.ts:417
```

**改动**：`createTrackedSettings()` 开头判断 `settings[TRACKED_SETTINGS_KEY]`（Proxy 的 get 陷阱会报告这个标记）
已存在就直接返回；`ensurePatchStateConfigTracking()` 只在未包过时才包一次。
两处调用点都不传 `enabled`，配置面板也是原地改 `state.config.settings`（不整体替换），所以语义不变。

## 10. header 渲染结果缓存（19% CPU）

**文件**：`vendor/pi-open-tui@0.3.5/extensions/open-tui/header.ts`
**标记**：搜 `LOCAL PATCH (pi-tui-suite)：渲染结果缓存`

**上游问题**：header 的 `render(width)` **每帧**都重画 logo（逐格 `hasCell`/`hasPiece`，内部还在
`split(" ")` 分配）+ 每个 `padRight()`（走 ANSI 宽度解析）。V8 采样剖分实测占 **19.1%** CPU：

```
1279.0ms  19.1%  truncateToWidth @ chunk-JVUZSMYM.js:552
         ↳ truncateToWidth ← padRight@utils.ts ← render@header.ts ← render ← renderCached ← layoutComponent
```

而头部内容只取决于「宽度 + 模型 + 思考等级 + cwd + 主题」，几乎不变。

**改动**：`render()` 先算上面的组合键命中缓存就直接返回；`invalidate()`（pi 在主题/尺寸变化时调用）
清掉缓存。注意 `ctx.model` / `thinkingLevel` / `cwd` 变化都会改键 ⇒ 不会显示陈旧信息。

## 11. 动画 tick 不再重复请求重绘（帧率直接减半）

**文件**：`vendor/alps-pi@0.3.3/src/features/animations/runtime.ts`
**标记**：搜 `LOCAL PATCH (pi-tui-suite)：不要重复请求重绘`

**上游问题**：`requestAnimationsRender()` 里 `renderWorkingAnimationFrame()` 会调用
`ui.setWorkingMessage(line)`，而 pi 的 `Loader.updateDisplay()` 结尾就是
`this.ui.requestRender()`（见 pi bundle 的 loader 实现）⇒ **一次动画 tick 排两帧**。
实测：`animations.fps = 4`，但探针量到 **8–10 帧/s**、`debounceTimers = 4/s`，
调用链也确认了请求方是动画计时器。

**改动**：`renderedWorking` 为真时直接 `return`，不再走 `animationsRenderRequest()`。
本 tick 的 `component.invalidate()` 在 `setWorkingMessage` 之前已完成，
所以那一帧照样会把动画组件一起画掉。预期帧率 8–10/s → 4–5/s（渲染开销直接减半）。

---

## 附：本轮性能排查的结论（2026-09-12）

**插件侧修掉的（都有实测数据）**

| # | 问题 | 修复前 → 修复后 |
| --- | --- | --- |
| 6 | 动画 fps 静默回落 16 | 工具窗口 CPU 100–114% → 63% |
| 9 | 每帧每组件都 `normalizeSettings` + 新建 8 个 Proxy | 剖分显示该项占 **34.8%** → 消失；单帧 65–70 ms → 43–52 ms |
| 10 | header 每帧重画 logo + `padRight`（ANSI 宽度解析） | 占 **19.1%** → 消失 |
| 11 | 动画 tick 重复请求重绘（`setWorkingMessage` 已排一帧） | 帧率 8–10/s → **4–6/s**（渲染开销减半） |
| 8 | 原生 spinner 与动画双计时器 | 本身收益有限，但去掉了叠加的不确定性 |

**剩下的属于 pi agent 自身，本套件不动**（用户明确要求）：
- `@earendil-works/pi-tui` **没有视口虚拟化** —— 每帧重渲染整个会话，单帧成本 ∝ 会话行数
  （本会话 3.1 MB / 929 条时单帧 33–77 ms）。
- 流式输出时 pi 每个 token 块都会触发重渲染（16 ms 节流），实测可达 ~24 帧/s ⇒ 这是 CPU 的主要去向。
- 热点函数 `truncateToWidth` / `graphemeWidth` / `matchCache`（markdown 高亮）全在 pi 的 bundle 里。

⇒ 根治需要给 pi-tui 的 ScrollView 打「只渲染视口」的补丁，属于改 pi agent 源码，不做。
**留给使用者的杠杆：别让会话太长**（帧成本 ∝ 行数；新会话单帧只需几 ms，按任务 `/new`、长了 `/compact`）。

---

## 上游同步流程

```bash
pi update npm:alps-pi                                  # 升级上游
bash tools/sync-upstream.sh --check alps-pi            # 看上游改了什么（本文件这三处会显示为差异）
bash tools/sync-upstream.sh --update alps-pi           # 抽到 vendor/alps-pi@<新版本>/
# 然后把本文件的 3 处改动重新打到新版本上，改 src/alps-pi/index.ts 的 import，/reload 核对
node tools/smoke-test.mjs                              # 至少保证模块图与装配不炸
```

版本记录：`alps-pi@0.3.3`（2026-09-12 首次 vendor）。
