# pi-tui-suite

给 [pi](https://github.com/earendil-works/pi)（`@earendil-works/pi-coding-agent`）用的**本地 TUI 套件**。
把消息/工具线框、固定输入框、底部状态栏、顶部 header 与账户余额角标收进**一个**扩展，
并针对手机端（Termux、48 列窄终端）调过布局与性能。

## 效果

**Android / Termux 手机端（终端 48 列）**的输入框区域 —— 示例如下：

```
deepseek/deepseek-flash                   ¥42.50      ← 模型名 · 账户余额
╭ med ───────── ↻ 92.3% ▤━━━╸────── 45.3%/128k ╮      ← 思考等级 · cache 命中率 · 上下文占用
│ > 输入框…                                    │
╰────── ↑ 6.7k · ↓ 580 · » 18.4tok/s · ◷ 1m12s ╯      ← 会话累计 token · 速度 · 时长
```

窄屏（手机）下「模型名 + 余额」会自动上提到输入框上方单独一行，
因为 48 列宽度里塞不下「左 model·thinking + 右 进度条·余额」—— 否则余额会被截掉。

**宽屏（≥120 列，如平板外接键盘 / 桌面终端）**则回到单行边框：

```
╭ deepseek/deepseek-flash · med ───────────────────────────── ↻ 92.3% ▤━━━╸────── 45.3%/128k ¥42.50 ╮
│ > 输入框…                                                                                         │
╰────────────────────────────────────────────────────────── ↑ 6.7k · ↓ 580 · » 18.4tok/s · ◷ 1m12s ╯
```

## 功能

| 功能 | 说明 |
| --- | --- |
| 消息 / 工具线框 | 助手消息、思考块、工具调用与结果统一圆角线框，含耗时与上下文占用估算；内置工具进入紧凑模式（只留关键信息） |
| 固定输入框 | 输入区固定在屏幕底部，始终可见；支持展开长输入 |
| 底部状态栏 | 其他扩展发布的 status（` › ` 分隔）+ `↳ 上一条问题` |
| 顶部 header | logo + 模型 / 思考等级 / 当前工作目录（不需要可在配置里关掉） |
| **账户余额角标** | 查 provider 账单接口显示余额（如 `¥42.50`），默认 10 秒刷新；连续失败自动退避，取数不消耗任何 token |
| **cache 命中率** | 最近一次请求的 prompt cache 命中比例，放在输入框上边框，窄屏也不会被裁 |
| **上下文占用** | 进度条 + 已用百分比 / 模型上下文窗口，占用越高颜色越警示 |
| 窄屏适配 | 手机端（Termux、48 列）自动把「模型名 + 余额」上提到输入框上方单独一行；宽屏保持单行边框 |
| 性能 | 动画帧率默认 4（档位可选 2/4/6/8/12/16/24/30）；线框渲染带结果缓存，长会话与流式输出不再占满 CPU |
| 深色主题自适应 | 线框、状态、按钮颜色全部取自 pi 主题 token |

## 安装

```bash
# 方式 A：让 pi 自己装（git 源）
pi install git:github.com/daltonxiong/pi-tui-suite

# 方式 B：手动把仓库放到任意目录，然后在 pi 配置目录（默认 ~/.pi/agent）的 settings.json
#         的 packages 里加上这个目录的相对路径（相对该 settings.json 所在目录），
#         路径按你 clone 的实际位置写，例如 "../../path/to/pi-tui-suite"，然后 /reload

# 无论哪种方式，都要在仓库目录装一次运行时依赖（vendored alps-pi 的 settings-store
# 静态 import 了 proper-lockfile）：
cd /path/to/pi-tui-suite && npm i --omit=dev
```

临时试用（不改配置，把路径换成你的实际位置）：

```bash
pi -e /path/to/pi-tui-suite/extensions/pi-tui-suite.ts
```

本套件已接管原本由三个插件各自负责的部分，因此建议把它们**停用**（保留安装，随时可恢复正常）：

```json
"packages": [
  { "source": "npm:pi-open-tui",      "extensions": [] },
  { "source": "npm:pi-rounded-tools", "extensions": [] },
  { "source": "npm:alps-pi@0.3.3",    "extensions": [], "themes": [] },
  "<pi-tui-suite 的相对路径>"
]
```

回滚：把上面三个对象改回字符串、删掉最后一条，`/reload`。

## 配置

`pi-tui-suite.json`（放在 pi 配置目录，默认 `~/.pi/agent/`；文件不存在即全部使用默认值）：

```json
{
  "log": "",
  "alpsPi": { "enabled": true, "animationsFps": 4 },
  "header": { "enabled": true },
  "roundedFrames": { "enabled": false },
  "balance": {
    "enabled": true,
    "label": "",
    "refreshSeconds": 10,
    "timeoutMs": 8000,
    "maxBackoffSeconds": 120,
    "providers": {}
  }
}
```

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `log` | `""` | 诊断日志路径，空＝关闭（也可用环境变量 `PI_TUI_SUITE_LOG`） |
| `alpsPi.enabled` | `true` | 线框 / 输入框 / 状态栏 / 动画 总开关 |
| `alpsPi.animationsFps` | `4` | 启动时把动画帧率钉在该值（可选 `2/4/6/8/12/16/24/30`）。低帧率显著省 CPU；设 `null` 则交给 `/alps-pi` 面板控制 |
| `header.enabled` | `true` | 顶部 header 开关 |
| `roundedFrames.enabled` | `false` | 额外的圆角工具框（开启后与主框叠加为两层） |
| `balance.enabled` | `true` | 余额角标开关 |
| `balance.label` | `""` | 余额前缀，默认只显示货币符号 + 金额 |
| `balance.refreshSeconds` | `10` | 刷新间隔；`0` ＝ 关闭轮询（只在会话开始 / 切模型 / 回合结束时查） |
| `balance.maxBackoffSeconds` | `120` | 连续失败时的退避上限 |
| `balance.providers` | `{}` | 额外 provider 的余额接口，见下 |

## 命令

| 命令 | 说明 |
| --- | --- |
| `/balance` | 立即刷新余额并显示明细（provider、原始数值、接口地址、更新时间） |
| `/alps-pi` | 打开套件设置面板（线框、动画、输入框快捷键等），改动即时生效 |

## 余额接口支持

| provider | 接口 | 说明 |
| --- | --- | --- |
| `deepseek` | `GET /user/balance` | 返回人民币余额与充值/赠送明细 |
| `openrouter`（含自建 provider id 包含 `openrouter` 的） | `GET /credits` | 额度减已用；也可用 `kind: "openrouter-key"` 读 `GET /key` 的剩余额度 |
| 其他 | 无 | 例如 NVIDIA NIM、OpenCode Zen 等只提供免费额度、没有余额接口，角标会自动隐藏 |

自建 provider 的余额接口：

```json
{
  "balance": {
    "providers": {
      "my-gateway": { "url": "https://my.gw/v1/credits", "kind": "openrouter-credits", "symbol": "$" }
    }
  }
}
```

`url` 里的 `{baseUrl}` 会替换成 pi 解析出的 baseUrl；`kind` 目前支持 `deepseek`、`openrouter-credits`、`openrouter-key`。

## 性能

内置两处优化，不需要配置：

- **动画帧率默认 4**（可选 `2/4/6/8/12/16/24/30`）：pi 每帧会重渲染整个会话，帧率直接等于 CPU 占用；
  桌面机器如果想更顺，把 `alpsPi.animationsFps` 调回 `16`（或 `null` 交回 `/alps-pi` 面板）。
- **渲染热点已修**：线框组件不再每帧重复归一化配置、header 渲染结果有缓存、动画 tick 不再重复请求重绘。

> 满屏重绘是 pi-tui 的固有设计（无视口虚拟化），单帧成本 ∝ 会话行数，
> 所以**长会话请按任务 `/new`、长了 `/compact`** —— 这比任何单帧优化都有效。

## 与上游的关系

本套件 `vendor/` 下按原样收了三份上游代码（见 `PATCHES.md` 记录了我们对 vendored 代码的每一处改动）：

| 目录 | 来源 |
| --- | --- |
| `vendor/alps-pi@0.3.3/` | [alps-pi](https://github.com/MrCKR/alps-pi) 全量 |
| `vendor/pi-open-tui@0.3.5/` | [pi-open-tui](https://github.com/OldSuns/pi-open-tui) 的 `header.ts` + `utils.ts` |
| `vendor/pi-rounded-tools@0.1.3/` | [pi-rounded-tools](https://github.com/orionpax1997/pi-rounded-tools) 单文件 |

上游升级：

```bash
bash tools/sync-upstream.sh --list              # 上游版本 / 本地已 vendor 的版本
bash tools/sync-upstream.sh --check             # 列出上游与 vendor 的差异（含我们的本地补丁）
bash tools/sync-upstream.sh --update alps-pi    # 抽取新版本到 vendor/alps-pi@<版本>/
```

开发辅助：

```bash
bash tools/link-dev-deps.sh                 # 建 headless 测试用的 node_modules 软链
node tools/smoke-test.mjs                   # 模块图 + 装配干跑
node tools/preview-frame.mjs 48 80          # 离线预览输入框线框
node tools/audit-bottom-layout.mjs          # 逐项审计底部区域在各宽度下显示了什么
```

## 致谢

本项目的观感来自下面三个开源插件，它们是本套件的**主要参考实现**，`vendor/` 里的代码版权归各自作者所有（均为 MIT）：

| 项目 | 作者 | 本套件采用的部分 |
| --- | --- | --- |
| [alps-pi](https://github.com/MrCKR/alps-pi) | [MrCKR](https://github.com/MrCKR) | 消息/工具线框、固定输入框、底部状态栏、动画、设置面板（全量 vendor） |
| [pi-open-tui](https://github.com/OldSuns/pi-open-tui) | [OldSuns](https://github.com/OldSuns) | 顶部 header（`header.ts` + `utils.ts`） |
| [pi-rounded-tools](https://github.com/orionpax1997/pi-rounded-tools) | [orionpax1997](https://github.com/orionpax1997) | 圆角工具框（可选，默认关闭） |

另外感谢 [pi](https://github.com/earendil-works/pi) 提供的扩展 API、主题 token 与 `@earendil-works/pi-tui` 组件。

## 许可

本项目自身代码（`src/`、`extensions/`、`tools/`）以 **MIT** 许可发布，见 `LICENSE`。
`vendor/` 下为第三方代码，版权与许可见 `THIRD-PARTY-NOTICES.md` 及各自目录内的 `LICENSE`。
