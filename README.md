# pi-tui-suite

把 pi 的 TUI 观感收敛成**一个**可自管、可 git 追溯、可逐步替换的本地套件。

- **阶段 1 ✅** footer 余额角标（内嵌在输入框上边框、紧跟上下文进度条后面）
- **阶段 2 ✅** 三个第三方插件（pi-open-tui / pi-rounded-tools / alps-pi）合并为本套件
- **阶段 3 ⬜** 给 vendored alps-pi 的 chromeFrame 打早退缓存（已打，待实测确认数字）

```bash
# 试用（不改配置）
pi -e ~/projects/pi-tui-suite/extensions/pi-tui-suite.ts

# 长期启用（已在本机 settings.json 里配好）
#   packages 里加 "../../projects/pi-tui-suite"，并把这四个包改成 extensions: [] 停用
#   /reload
```

---

## 一、原来那三个插件在抢什么（为什么值得合并）

| 插件 | 版本 | 代码量 | 真正生效的部分 | 死代码 / 重复 |
|---|---|---|---|---|
| `alps-pi` | 0.3.3 | 8,840 行 / 35 文件 | chromeFrame（消息与工具线框）、animations、固定输入框 + footer、设置 UI 与命令 —— **全都在用** | `*debug.ts` 约 590 行诊断代码（默认关闭） |
| `pi-open-tui` | 0.3.5 | 3,522 行 / 15 文件 | **只有 header**（静态 logo，`invalidate(){}`） | footer.ts(328) / editor.ts(290) 因 alps-pi 抢到 slot 而是死代码；peek.ts、fullscreen-scroll.ts 只挂在 editor 那条死路径上；telemetry/git/settings-command 用不上 ⇒ **≥2,000 行死重** |
| `pi-rounded-tools` | 0.1.3 | 257 行 / 1 文件 | 给 7 个内置工具加圆角框（自缓存写得挺干净） | 与 alps-pi 的框**叠成两层**（内置工具双框，MCP 工具单框） |
| `@firstpick/pi-themes-bundle` | — | 主题 JSON | 只是配色 | 无（≈0 每帧成本，无需合并） |

合并后：**一个扩展**，vendored alps-pi（8,840 行）+ 从 pi-open-tui 抽出的 header（625 行）+ 圆角框（257 行，默认关），
砍掉 ~2,000 行永不执行的代码，并且不再有"谁赢 slot 由 `packages` 数组顺序决定"这种隐蔽行为。

**合并本身不省 CPU**——省 CPU 靠两件事：

1. **帧率**：alps-pi `animations.fps` 16 → 4，实测 `sleep` 工具期间 **100% → 12.8%**（闲时 0.3%）。
2. **每帧成本**：pi-tui 无视口虚拟化，每帧重渲染整个 transcript（长会话 1.67 万行 × ~3.7 µs ≈ 62 ms）；
   流式期间每个 token 都触发重渲染 ⇒ 实测 81–104% CPU。修复见 PATCHES.md 第 1 条（早退缓存）。

成本模型、实测数据见 `~/.pi/agent/docs/troubleshooting.md` 的 **ERR-013**。

---

## 二、结构

```
pi-tui-suite/
├── extensions/pi-tui-suite.ts     # pi 加载入口（只做装配）
├── src/
│   ├── alps-pi/index.ts           # vendored alps-pi 的装配层
│   ├── header/index.ts            # 顶部 header（只搬 pi-open-tui 的 header.ts + utils.ts）
│   ├── balance/{index,adapters}.ts# footer 余额角标
│   ├── config.ts  log.ts
├── vendor/
│   ├── alps-pi@0.3.3/             # 原样 + 3 处登记过的本地补丁（PATCHES.md）
│   ├── pi-open-tui@0.3.5/         # 只抽 header.ts + utils.ts
│   └── pi-rounded-tools@0.1.3/    # 257 行，默认不装（一层框）
├── tools/
│   ├── sync-upstream.sh           # 上游同步：--list / --check / --update
│   ├── link-dev-deps.sh           # 给 headless 冒烟建 node_modules 软链
│   └── smoke-test.mjs             # 用 jiti 跑一遍模块图 + 装配干跑
└── PATCHES.md                     # vendored 代码里被我们改过的每一处（必须登记）
```

原则：`vendor/` 保持上游原样，**只允许** `PATCHES.md` 里登记的改动；我们的代码一律放 `src/`。

---

## 三、余额角标

显示成 `¥16.68`（**只有货币符号 + 金额，没有多余文字**），位置在输入框**上边框**、紧跟上下文进度条：

```
╭── deepseek-flash · medium ───────────────────── ▤━━━━━━━╸── 42.3%/128k ¥16.68 ──╮
│ > 输入框…                                                                        │
╰──────────────────────────────────────── ⚡ 1.2k  ⇅ 340  ⏱ 12s ─────────────────╯
```

（线框内嵌由 PATCHES.md 第 2 条实现；如果哪天把 `beautifiedInput` 关掉，它会自动回到输入框下方的
statuses 行，不会消失。）

### 取数策略

| 时机 | 行为 |
| --- | --- |
| `session_start` / `model_select` | 立刻拉一次（provider 换了必须换数字） |
| 定时器 `refreshSeconds`（默认 **10s**） | 周期刷新，能看到花钱在变；`unref` 不影响退出 |
| `turn_end` | 超过间隔才拉（保底） |
| `/balance` | 强制刷新，并 notify 明细（provider、原始数字、接口 URL、更新时间） |

- **失败退避**：连续失败 5s → 10s → 20s … 上限 `maxBackoffSeconds`（默认 120s），成功即恢复；429/断网时不会一直撞。
- **不打扰渲染**：只有文本真的变了才 `setStatus`（长会话里 setStatus 会触发重绘，见 ERR-013）。实测 9 秒内 4 次取数只写了 1 次状态。
- 密钥解析顺序：`ctx.modelRegistry.getApiKeyAndHeaders(ctx.model)` → `getProviderAuth(id)` → `auth.json` 兜底；**密钥不进日志**。

### 适配器（已实测）

| provider 匹配 | 接口 | 解析 |
| --- | --- | --- |
| `*deepseek*` | `{baseUrl}/user/balance` | `balance_infos[0].total_balance` + `currency`（CNY） |
| `*openrouter*` | `{baseUrl}/credits` | `total_credits - total_usage`（USD，夹到 ≥0） |
| `*openrouter*`（`kind: "openrouter-key"`） | `{baseUrl}/key` | `limit_remaining` |
| `free-opencode`、`free-nvidia` | — | **实测没有余额接口**（`/credits`、`/key` 均 404），角标自动清空 |

加新 provider：`~/.pi/agent/pi-tui-suite.json` 的 `balance.providers`（按 id 子串匹配，优先于内置表）：

```json
{
  "log": "",
  "alpsPi": { "enabled": true },
  "header": { "enabled": true },
  "roundedFrames": { "enabled": false },
  "balance": {
    "enabled": true,
    "label": "",
    "refreshSeconds": 10,
    "timeoutMs": 8000,
    "maxBackoffSeconds": 120,
    "providers": {
      "my-gateway": { "url": "https://my.gw/v1/credits", "kind": "openrouter-credits", "symbol": "$" }
    }
  }
}
```

`label` 默认空串＝只显示符号+金额；`refreshSeconds: 0` 关闭轮询（只保留事件触发的刷新）。

---

## 四、阶段 2 做了什么

1. **vendor alps-pi@0.3.3**：整包进 `vendor/`（内部 import 全是相对路径，原样可用）。
   唯一运行时依赖 `proper-lockfile` 已 `npm i` 进仓库（它的 `settings-store.ts` 是静态 import）。
2. **抽 header**：只搬 `header.ts` + `utils.ts`（625 行），替掉 pi-open-tui 全部 3,522 行。
3. **圆角框**：`vendor/pi-rounded-tools@0.1.3` 保留但**默认不装**（`roundedFrames.enabled: false`）
   ⇒ 内置工具与 MCP 工具都是**一层框**（alps-pi 的框）。想要现在的双层观感就把开关打开。
4. **两处本地补丁**（详见 `PATCHES.md`）：
   - chromeFrame **早退缓存** —— 修流式/长会话每帧 62 ms 的主项；
   - 余额**内嵌上边框** —— 也就是第三节那个效果。

装配顺序在 `extensions/pi-tui-suite.ts` 里：alps-pi（铺底）→ 余额 → 圆角框（可选）→ header。
alps-pi 自带 `TUI_OWNER_KEY` 单例守卫，所以哪怕 npm 包和 vendored 副本同时被加载，也不会出现两套 UI。

---

## 五、上游同步

```bash
bash tools/sync-upstream.sh --list                 # 上游装了什么版本 / vendor 里有什么
bash tools/sync-upstream.sh --check                # 逐文件比对上游 vs vendor（我们的补丁会显示为差异）
bash tools/sync-upstream.sh --update alps-pi       # 抽到 vendor/alps-pi@<新版本>/
```

升级流程：`pi update npm:alps-pi` → `--check` 看差异 → `--update` 抽新版本 →
**按 `PATCHES.md` 重新打那 3 处补丁** → 改 `src/alps-pi/index.ts` 的 import 版本号 → `node tools/smoke-test.mjs` → `/reload` 核对观感。

---

## 六、启用 / 停用 / 回滚

`~/.pi/agent/settings.json` 里现在是这个形态（停用但**不卸载**，回滚只需改回来）：

```json
"packages": [
  { "source": "npm:pi-open-tui",      "extensions": [] },
  { "source": "npm:pi-rounded-tools", "extensions": [] },
  { "source": "npm:alps-pi@0.3.3",    "extensions": [] },
  "../../projects/pi-tui-suite"
]
```

```bash
# 回滚到"三个 npm 包各管一摊"的原状：把上面三个对象换回字符串，删掉最后那条，然后 /reload
# 只停用本套件：删掉最后一条 + /reload（或 rm 目录，但运行中的进程必须 /reload 才会卸载）
```

配置：`~/.pi/agent/pi-tui-suite.json`（不存在＝全默认）。
日志：默认关闭；`PI_TUI_SUITE_LOG=$TMPDIR/pi-tui-suite.log` 或配置里的 `log` 字段打开（>256 KB 自动清空）。

---

## 七、开发

```bash
bash tools/link-dev-deps.sh     # 建 jiti / @earendil-works/* 的 node_modules 软链（headless 测试用）
node tools/smoke-test.mjs       # 用 jiti 跑一遍模块图 + 装配干跑（pi 真渲染路径覆盖不到）
node $TMPDIR/suite-balance-test.mjs   # 余额模块端到端（真打 DeepSeek / OpenRouter 接口）
```

> 别用 `node --experimental-strip-types` 跑本仓库：它只剥类型，遇到参数属性
> （`constructor(private readonly x: T)`，vendored 的 pi-rounded-tools 里就有）会直接报
> `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`。pi 自己用的是 jiti（真转译）。

---

## 八、相关记录

- `~/.pi/agent/docs/troubleshooting.md` → **ERR-013**（长会话卡顿的成本模型与实测数字）、**ERR-012**（切前后台输入框消失）
- `~/.pi/agent/docs/tui-cleanup-notes.md` → 三个插件的 slot 归属与加载顺序推导
- `~/pi-workspace/tools/pi-perf-sample.sh` → 进程 CPU/IO/RSS 采样器（做性能 A/B 用）
- `PATCHES.md` → vendored 代码里被我们改过的每一处

## 许可

`src/`、`extensions/`、`tools/` 为原创（MIT）。`vendor/` 下为第三方原样拷贝 + 本地补丁，均为 MIT，版权归各自作者：
alps-pi（[MrCKR](https://github.com/MrCKR/alps-pi)）、pi-open-tui（[OldSuns](https://github.com/OldSuns/pi-open-tui)）、
pi-rounded-tools（[orionpax1997](https://github.com/orionpax1997/pi-rounded-tools)）。
