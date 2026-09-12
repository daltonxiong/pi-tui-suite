# 本地补丁清单（vendor/ 里被我们改过的地方）

约定：`vendor/` 原则上保持上游原样，**只允许**以下几处改动，且必须登记在这里。
`bash tools/sync-upstream.sh --check <pkg>` 会把所有差异列出来 —— 看到差异就来本文件核对是不是这三处之一。

---

## 1. chromeFrame 早退缓存（性能修复，ERR-013 的主项）

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
  ⇒ 变成 `... ▤━━━━╸───── 42.3%/128k ¥17.29 ╮`。
- 线框关闭时（`beautifiedInput.enabled = false`）内嵌没有落点，余额自动回到下方 statuses 行（原行为）。

**取消内嵌**：把 `"balance"` 从 `LOCAL_INLINE_STATUS_KEYS` 删掉即可，其余逻辑不用动。

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
