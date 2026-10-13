# 项目排错记录（pi-tui-suite）

> 条目格式见 `~/.pi/agent/troubleshooting/troubleshooting-template.md`。
> 主文件只留活跃条目（上限 40 条 / 50 KB）；归档放 `docs/archive/`，编号与锚点不变。

## 索引

| 编号 | 现象关键词 | 状态 | 一句话解法 |
| --- | --- | --- | --- |
| [ERR-001](#err-001) | 右键粘贴 两次 / paste twice / Orca / TERM_PROGRAM | 已解决 | 让 `TERM_PROGRAM=orca`（及同类终端）跳过 pi 的合成右键粘贴，交回终端原生粘贴 |

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
