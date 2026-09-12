# pi-tui-suite

把 pi 的 TUI 观感收敛成**一个可自管、可 git 追溯、可逐步替换**的本地套件。

当前状态：**阶段 1 已实现**（footer 余额角标）；三个第三方插件的合并方案、成本清单与上游同步工具在本仓库固化。

```bash
# 试用（不改任何配置）
pi -e ~/projects/pi-tui-suite/extensions/pi-tui-suite.ts

# 长期启用：在 ~/.pi/agent/settings.json 的 packages 里加一条（本项目与 pi-termux-notify 同一套约定）
#   "../../projects/pi-tui-suite"
# 然后 /reload
```

---

## 一、现状：三个插件到底在抢什么

观感目前由三个互相独立的第三方插件拼出来，各自的"活/死"情况（2026-09-12 在本机核对源码后统计）：

| 插件 | 版本 | 代码量 | 真正生效的部分 | 死代码 / 重复 | 每帧成本 |
|---|---|---|---|---|---|
| `alps-pi` | 0.3.3 | **8,840 行 / 35 文件** | chromeFrame（消息与工具线框）、animations、bottom-input（editor + 部分 footer）、footer、设置 UI 与命令 —— **全部在用** | `*debug.ts` 三件约 590 行为诊断代码（默认关闭） | **主项**：chromeFrame 每帧对每个组件的全部行重新装箱，无结果缓存（见下） |
| `pi-open-tui` | 0.3.5 | 3,522 行 / 15 文件 | **只有 header**（静态 logo，`invalidate(){}`，几乎不花 CPU） | footer.ts(328) / editor.ts(290) 因 alps-pi 抢到 slot 而是死代码；`peek.ts`、`fullscreen-scroll.ts` 只在 editor 路径里被调用 ⇒ 一起死；telemetry/git/settings-command 基本用不上 ⇒ **≥2,000 行死重** | ≈ 0（它的 250ms `workingTimer` 因为 footer 工厂从未被调用而是 no-op） |
| `pi-rounded-tools` | 0.1.3 | **257 行 / 1 文件** | 给 7 个内置工具加圆角框（带自缓存，写得挺干净） | 与 alps-pi 的框**叠成两层**（内置工具=两层框，MCP/自定义工具=一层） | 中等（只影响工具块的行） |
| `@firstpick/pi-themes-bundle` | — | 主题 JSON | 只是配色 | — | ≈ 0（副作用：truecolor 序列让写入字节多 ~1.4×） |

成本模型与实测（为什么"长会话才卡"）见 `~/.pi/agent/docs/troubleshooting.md` 的 **ERR-013**：
pi-tui 没有视口虚拟化，每帧都要重渲染整个 transcript；工作期间的帧率由 alps-pi 的 `animations.fps` 决定。
实测 pi 0.85.1 + 1.2 MB 会话：`fps:16` 时 **CPU 108–114%**，`fps:4` 后降到 **25%**。

**所以"合并"的价值不在省 CPU**（省 CPU 靠配置与删重复，已单独做过），而在于：

1. 消掉三个插件互相抢 slot（谁赢由 `packages` 数组顺序决定，极其隐蔽）；
2. 删掉 ≥2,000 行永远跑不到的死代码；
3. 给"本地补丁"一个正式的家 —— 例如**给 alps-pi 的 chromeFrame 加结果缓存**（阶段 2 的主要收益）；
4. 配置集中：现在散在 `settings.json`（alps-pi 块）、`open-tui.json`、以及两个 npm 包的默认值里。

代价：alps-pi 8.8k 行只能 vendor（它没导出可复用的入口），上游还在活跃开发 ⇒ **必须有同步脚本 + 版本目录**（见第五节的维护流程）。

---

## 二、目标结构

```
pi-tui-suite/
├── extensions/pi-tui-suite.ts     # pi 加载入口（只做装配，不放业务逻辑）
├── src/                           # 我们自己维护的代码
│   ├── balance/                   # 阶段 1 ✅ 余额角标
│   ├── config.ts  log.ts          # 配置与可选日志
│   ├── header/                    # 阶段 2：从 pi-open-tui 抽 header（唯一活着的部分）
│   └── rounded-frame.ts           # 阶段 2：从 pi-rounded-tools 搬（257 行，加开关）
├── vendor/alps-pi@0.3.3/          # 原样拷贝、永不修改；上游更新靠 tools/sync-upstream.sh
└── tools/sync-upstream.sh         # 从 node_modules 重新抽取 + diff
```

原则：**vendor 目录只读**，所有本地改动都写在 `src/`，需要改 vendor 的代码就记进 `src/patches/`（阶段 2 建），
这样"哪些是我们改的"永远一眼可见，上游更新也不会被本地改动糊住。

---

## 三、阶段 1：footer 余额角标（已实现）

footer 里显示当前 provider 的账户余额：

```
...  ›  余 ¥17.29  ›  ...
```

机制：用 pi 的扩展状态 `ctx.ui.setStatus("balance", "余 ¥17.29")`，由 footer 渲染（当前是 alps-pi 的 footer，
以 `›` 分隔多个状态）⇒ **不碰任何渲染代码，与三个美化插件零冲突**，这也是拿它当套件第一个模块的原因。

### 取数策略（不阻塞主流程，失败保留上一次的值）

| 时机 | 行为 |
| --- | --- |
| `session_start` / `model_select` | 立刻拉一次（provider 变了必须换） |
| `turn_end` | 距上次成功超过 `refreshMinutes`（默认 10）才拉 —— 长会话自动刷新，不会每回合都打网络 |
| `/balance` | 强制拉一次，并 notify 明细（provider、原始数字、接口 URL、更新时间） |

### 适配器表（已实测）

| provider 匹配 | 接口 | 解析 | 实测结果 |
| --- | --- | --- | --- |
| `*deepseek*` | `{baseUrl}/user/balance` | `balance_infos[0].total_balance` + `currency`（CNY） | ✅ `余 ¥17.29` |
| `*openrouter*` | `{baseUrl}/credits` | `total_credits - total_usage`（USD，夹到 ≥0） | ✅ `余 $0.00` |
| `*openrouter*`（用 `kind: "openrouter-key"`） | `{baseUrl}/key` | `limit_remaining` | ✅（该 key 未设上限时会报错，属预期） |
| `free-opencode`（opencode.ai/zen/v1） | — | **没有余额接口**：`/credits`、`/key` 实测 404 | 角标清空 |
| `free-nvidia`（integrate.api.nvidia.com/v1） | — | **没有余额接口**：`/credits` 实测 404 | 角标清空 |

> 这两个 provider 的模型名都以 `-free` 结尾 —— 本来就是免费额度，没有"余额"概念，不要浪费时间猜接口。

取数凭据的解析顺序（**密钥不写日志、不落盘**）：
`ctx.modelRegistry.getApiKeyAndHeaders(ctx.model)`（最准，`models.json` 的 baseUrl/headers 覆盖都在里面）
→ `getProviderAuth(providerId)`
→ 兜底直接读 `~/.pi/agent/auth.json`（结构 `{ "<provider>": { type, key } }`）。

### 加新 provider

`~/.pi/agent/pi-tui-suite.json`：

```json
{
  "log": "",
  "balance": {
    "enabled": true,
    "label": "余 ",
    "refreshMinutes": 10,
    "timeoutMs": 8000,
    "providers": {
      "my-gateway": { "url": "https://my.gw/v1/credits", "kind": "openrouter-credits", "symbol": "$" }
    }
  }
}
```

- `providers` 里按 provider id **子串**匹配（优先于内置表）；`url` 里的 `{baseUrl}` 会被替换成 pi 解析出的 baseUrl。
- 全新响应格式：在 `src/balance/adapters.ts` 加一个 `kind` 分支（解析函数 `parseBalancePayload`）。

---

## 四、阶段 2：合并三个插件（计划，未开始）

目标：**观感不变**，但只剩一个扩展在跑。

1. **vendor alps-pi**：`tools/sync-upstream.sh --update alps-pi` 抽到 `vendor/alps-pi@0.3.3/`（内部 import 全是相对路径，原样可用）；
   它唯一的运行时依赖 `proper-lockfile` 需要 `npm i` 到本仓库（只用于它自己的设置持久化）。
2. **抽 header**：只搬 `header.ts` + `utils.ts`（约 625 行），替掉整个 pi-open-tui（3,522 行里 2,000+ 是死代码）。
   header 是静态的，不需要动画/telemetry/git 那一摊。
3. **搬圆角框**：`rounded-frame.ts`（257 行），加开关：
   - `off`（默认候选）：只用 alps-pi 的框 —— 内置工具**一层**框，和 MCP 工具一致；
   - `on`：圆角框嵌在 alps-pi 框内（＝你现在的观感，两层）。
4. **本地补丁（真正的性能收益）**：给 alps-pi 的 `createWrappedRender` 加**结果缓存**
   （键：`innerLines` 数组引用 + 宽度 + status + configVersion），把它从"每帧对所有行 join+装箱"变成纯缓存命中。
   预期：长会话单帧成本从 ~62 ms 降到个位数 ms，流式期间不再占满 CPU。
5. **切换**：`settings.json` 的 `packages` 里删掉三个 npm 条目、加本地路径；先备份 settings.json，
   出问题一条命令回滚（见下节）。切完保留 `pi-open-tui.json` 之类的旧配置文件一个版本再删，方便对照。

---

## 五、维护：上游同步

```bash
bash tools/sync-upstream.sh --check                 # 与当前 vendored 版本比对（只报差异）
bash tools/sync-upstream.sh --update alps-pi        # 重新抽取 + 提示新版本目录名
bash tools/sync-upstream.sh --list                  # 列出现在装了哪些上游版本
```

抽取源是 pi 的 npm 安装目录 `~/.pi/agent/npm/node_modules/<pkg>`。升级流程：
`pi update npm:alps-pi` → 跑 `--update` 抽到 `vendor/alps-pi@<新版本>/` → 改 `extensions/pi-tui-suite.ts` 的 import → `/reload` → 观感核对。

版本与来源记录写在 `UPSTREAM.md`（阶段 2 建）。

---

## 六、安装 / 卸载 / 回滚

```bash
# 启用（追加到 packages 数组，注意保留其它条目）
python3 - <<'EOF'
import json, pathlib
p = pathlib.Path.home()/".pi/agent/settings.json"
d = json.loads(p.read_text())
if "../../projects/pi-tui-suite" not in d["packages"]:
    d["packages"].append("../../projects/pi-tui-suite")
p.write_text(json.dumps(d, indent=2, ensure_ascii=False)+"\n")
EOF
# 然后 pi 里 /reload

# 停用：settings.json 里删掉那一条 + /reload（或直接 rm 该行；扩展在跑时删文件不会卸载，必须 reload）
```

配置：`~/.pi/agent/pi-tui-suite.json`（缺省全用内置默认值，文件不存在也正常工作）。
日志：默认关闭；`PI_TUI_SUITE_LOG=$TMPDIR/pi-tui-suite.log` 或配置里的 `log` 字段打开（>256 KB 自动清空）。

---

## 七、相关记录

- `~/.pi/agent/docs/troubleshooting.md` → **ERR-013**（长会话卡顿的成本模型与实测数字）、**ERR-012**（切前后台输入框消失）
- `~/.pi/agent/docs/tui-cleanup-notes.md` → 三个插件的 slot 归属与加载顺序推导
- `~/pi-workspace/tools/pi-perf-sample.sh` → 进程 CPU/IO/RSS 采样器（做性能 A/B 用）

## 许可

本仓库 `src/`、`extensions/` 为原创（MIT）。`vendor/` 下为第三方原样拷贝，均为 MIT，版权归各自作者：
alps-pi（[MrCKR](https://github.com/MrCKR/alps-pi)）、pi-open-tui（[OldSuns](https://github.com/OldSuns/pi-open-tui)）、
pi-rounded-tools（[orionpax1997](https://github.com/orionpax1997/pi-rounded-tools)）。
