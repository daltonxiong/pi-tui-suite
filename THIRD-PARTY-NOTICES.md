# 第三方代码声明 / Third-Party Notices

本仓库 `vendor/` 目录下包含第三方开源代码（原样拷贝，另有 `PATCHES.md` 记录的少量本地改动）。
以下项目的版权归各自作者所有，均以 MIT 许可发布；完整许可原文见各目录内的 `LICENSE`。

---

## alps-pi

- 目录：`vendor/alps-pi@0.3.3/`
- 来源：https://github.com/MrCKR/alps-pi
- 作者：MrCKR
- 许可：MIT
- 版权声明：

  ```
  MIT License
  Copyright (c) 2026 MrCKR
  ```

- 本套件采用的实现：消息与工具线框（chromeFrame）、固定输入框（bottom-input）、顶部状态栏/底部状态栏、动画、设置面板与 `/alps-pi` 命令。

## pi-open-tui

- 目录：`vendor/pi-open-tui@0.3.5/`（仅 `extensions/open-tui/header.ts` 与 `extensions/open-tui/utils.ts`）
- 来源：https://github.com/OldSuns/pi-open-tui
- 作者：pi-open-tui contributors（维护者 OldSuns）
- 许可：MIT
- 版权声明：

  ```
  MIT License
  Copyright (c) 2026 pi-open-tui contributors
  ```

- 本套件采用的实现：顶部 header 布局与图标集。

## pi-rounded-tools

- 目录：`vendor/pi-rounded-tools@0.1.3/`（单文件 `extensions/rounded-tools.ts`）
- 来源：https://github.com/orionpax1997/pi-rounded-tools
- 作者：orionpax1997
- 许可：MIT
- 版权声明：

  ```
  MIT License
  Copyright (c) 2026 orionpax1997
  ```

- 本套件采用的实现：内置工具的圆角外框（默认关闭，由配置 `roundedFrames.enabled` 控制）。

---

## MIT License（适用于上述第三方代码）

```
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
