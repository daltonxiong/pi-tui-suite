# 项目排错记录（pi-tui-suite）

> 条目格式见 `~/.pi/agent/troubleshooting/troubleshooting-template.md`。
> 主文件只留活跃条目（上限 40 条 / 50 KB）；归档放 `docs/archive/`，编号与锚点不变。

## 索引

| 编号 | 现象关键词 | 状态 | 一句话解法 |
| --- | --- | --- | --- |
| [ERR-001](#err-001) | 右键粘贴 两次 / paste twice / Orca / TERM_PROGRAM | 已解决 | 让 `TERM_PROGRAM=orca`（及同类终端）跳过 pi 的合成右键粘贴，交回终端原生粘贴 |
| [ERR-002](#err-002) | 上下文 60% 就爆 / maximum context length / 400 / max_tokens | 已解决 | 着色改按「窗口 − maxTokens − 4096」算，越过打 `!`；根治靠调小 `models.json` 的 `maxTokens` |

---

<a id="err-001"></a>
### ERR-001 · Windows 上鼠标选中后，输入端把内容粘贴两次

| | |
| --- | --- |
| **首次 / 最近** | 2026-10-14 / 2026-10-14 |
| **状态** | 已解决 |
| **环境** | Windows · Orca 终端 1.4.214（`TERM_PROGRAM=Orca`）· pi / pi-tui 1.2.0 · fullscreen 模式 |

**现象**　在 Orca 终端里选中文本（或先复制）后，一次右击粘贴会让 pi 输入框出现两份内容
（例如粘贴 `hello123` 显示 `hello123hello123`）；`Ctrl+V` 正常单次。

**根因**　一次右击触发了**两条**粘贴路径：

1. pi 在 fullscreen 模式打开鼠标追踪（`?1000h ?1002h ?1003h ?1004h ?1006h`），Orca 把右键按下
   （SGR `ESC[<2;x;yM`）转发给应用，`TuiAltScreen.handleRightClickPaste()` 于是自己读剪贴板并注入
   `ESC[200~…ESC[201~`（这段合成路径是为了「只转发、不粘贴」的 Windows Terminal 保留的）。
2. Orca 终端自己也会粘贴（右键粘贴 / 上下文菜单），把同样内容按 bracketed paste 写到 pi 的 stdin。

同一个 pi 0.84.3 起只对 `TERM_PROGRAM=vscode` 做了规避（上游 issue #8186），
Orca 被报告过（issue #10825）但自动关闭、无人修，所以 `TERM_PROGRAM=Orca` 仍然双份。

**解决方案**　套件内置 `rightClickPaste` 补丁（`src/right-click-paste/index.ts`）：

- 包住 `TuiAltScreen.prototype.handleRightClickPaste`，命中 `rightClickPaste.skipTerminals`
  （默认 `["vscode", "orca"]`，大小写不敏感）就返回 `false`，让事件交给终端自己的粘贴路径。
- 只做「跳过名单」这一件事，其余原样透传上游 —— 上游将来补的判定不会被覆盖。
- 只在 win32 生效；名单可配置，填 `[]` 则完全保留 pi 的合成粘贴。

验证：`node tools/smoke-test.mjs` 现在覆盖该回归（Orca 让位、Windows Terminal 保留原行为）。

**替代方案 / 一般化教训**　判断标准是「这个终端会不会自己粘贴」——**会**的（VS Code、Orca 这类
Electron/xterm.js 终端）必须跳过 pi 的合成粘贴；**不会**的（Windows Terminal、mintty）必须保留，
否则右击粘贴直接失效。遇到同类重复粘贴，先 `env | grep TERM_PROGRAM` 拿到终端标识，再加进名单。

**涉及文件**　`src/right-click-paste/index.ts`、`src/config.ts`、`extensions/pi-tui-suite.ts`、`tools/smoke-test.mjs`

---

<a id="err-002"></a>
### ERR-002 · 上下文指示才 60% 多，下一条请求就 400 爆窗口

| | |
| --- | --- |
| **首次 / 最近** | 2026-10-30 / 2026-11-06 |
| **状态** | 已解决（显示层）；根因在模型配置 |
| **环境** | pi 1.5.0 · `deepseek` / `deepseek-flash`（`contextWindow` 1048576、`maxTokens` 393216） |

**现象**　输入框上边框显示 `67.4%/1.0M`（看着还有三分之一窗口），下一条请求直接返回
`400: This model's maximum context length is 1048576 tokens. However, you requested 1049860 tokens (724267 in the messages, 325593 in the completion)`。会话里没有任何 compaction 条目。

**根因**　不是显示 bug，而是三件事叠在一起：

1. pi 发请求前 `clampMaxTokensToContext()`：`max_tokens = min(model.maxTokens, 窗口 − estimateContextTokens(ctx) − 4096)`
   （`pi-ai/dist/api/simple-options.js`，`CONTEXT_SAFETY_TOKENS = 4096`）；
2. provider 把 prompt 与 completion 记在**同一个**窗口。所以只要上下文超过
   `窗口 − maxTokens − 4096 = 651264`（即 62.1%），pi 就把窗口剩余全揽给 `max_tokens`，只剩 4096 兜估算误差；
3. `estimateContextTokens()` 用 chars/4（中文/JSON 工具结果严重偏低）。那次估算 718887，真实 724267，
   误差 5380 > 4096 ⇒ 超窗 1284 tokens。

而进度条只在 70%/90% 变黄变红，与真实临界点（62%）错位，所以 67% 看上去安全。

**解决方案**

- 显示层（插件已改，见 `PATCHES.md` 第 13 条）：`contextThresholds()` 按
  `窗口 − maxTokens − 4096` 算错误档位，`tokens` 越过它就用错误色并在百分比后加 `!`。
- 根治（配置，本机已落地）：`~/.pi/agent/models.json` 的 `maxTokens` 由 393216 改成 65536（爆点从
  62.5% 推到 93.8%），`~/.pi/agent/settings.json` 用 `compaction.modelOverrides` 给
  `deepseek/deepseek-flash` 与 `deepseek/deepseek-v4-pro` 设 `reserveTokens: 150000`、
  `keepRecentTokens: 20000`（自动压缩在 85.7% 触发）。摘要请求在阈值处只需 964k/1048k，
  离爆点还有 84k 的估算误差空间。不要用顶层 `compaction.reserveTokens = 150000`：
  落到 128k 窗口的模型上会让阈值恒成立，每轮都压。

**替代方案 / 一般化教训**　判断上下文是否安全，要看「窗口 − 输出上限」而不是只看用量百分比；
带大 `maxTokens` 的模型（1M 窗口配 393216 输出）从 62% 起就进入风险区。看到 `%` 后面带 `!`
就该 `/compact`。改 `models.json` 后必须重启 pi（模型配置只在启动时加载）。
复盘时直接读会话 JSONL 里的 `usage.input/output/cacheRead/cacheWrite` 与 `stopReason`，比看 TUI 显示准。

**涉及文件**　`vendor/alps-pi@0.3.3/src/features/bottom-input/status.ts`、`tools/smoke-test.mjs`、`PATCHES.md`

---
