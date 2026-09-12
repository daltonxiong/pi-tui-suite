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

**改动**：`ANIMATION_FPS_VALUES` 补上 `2,4,6`；两处默认值 `fps: 16 → 4`。
这样无论谁回写、或 namespace 缺失走默认值，都是 4。（想要更丝滑可在 `/alps-pi` 里选 8/12。）

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
