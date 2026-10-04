# IINA SubHD 中文字幕插件

在 IINA 的“字幕 → 在线查找字幕”中搜索 SubHD 中文字幕，使用 IINA 内置的候选列表展示片源名称、来源、语言、格式及下载次数。选中字幕后，插件下载完整文件并返回本地路径供 IINA 加载。

支持 SRT、ASS、SSA、VTT，以及 ZIP、RAR、7z 压缩包中的这些字幕。优先选择中英双语或中文字幕；电影年份、卷号和剧集编号参与匹配。文件保持原始编码，压缩包只读取选中的字幕成员。

## 安装和使用

1. 从 [Releases](https://github.com/Andy-GHJ/iina-subhd/releases) 下载 `SubHD-0.2.1.iinaplgz`，在 IINA 的“插件 → 管理插件 → 安装本地插件…”中选择该文件。
2. 确认插件权限及替换已有版本。如果已有播放器窗口仍使用旧版本，可选择“插件 → 重新加载所有插件”。
3. 在 IINA 的字幕设置中选择“SubHD 中文字幕”作为在线字幕提供方。
4. 播放影片，选择“字幕 → 在线查找字幕”，在内置列表中选择匹配片源后下载。

插件针对 IINA 1.5.0 验证。完整文件下载使用 macOS 自带的 `/usr/bin/curl`，压缩包使用 `/usr/bin/bsdtar`，不需要安装 Python、Node 或其他运行依赖。Node 仅用于开发测试。

仓库目前处于私有审阅阶段，下载 Release 需要登录拥有访问权限的 GitHub 账号；IINA 无法匿名检查此私有仓库的更新，期间请使用 Release 安装包更新。仓库公开后，也可在 IINA 插件管理器中使用 GitHub 地址 `https://github.com/Andy-GHJ/iina-subhd` 安装。

## 站点设置

新安装默认主站为 `https://subhd.tv`，备用站为 `https://subhd.me`。保留已有版本保存的站点设置，不会自动改写。可在插件偏好设置中配置允许的 SubHD 镜像；备用站留空可关闭回退。

搜索和下载失败时会尝试配置的备用站。文件请求还允许对应的 `dl.subhd.*` 下载域名。下载会话使用独立的匿名 Cookie，仅保存在插件临时目录，请求结束后删除；不读取浏览器 Cookie。字幕文件由 IINA 按其临时目录规则管理。

## 0.2.1 来源显示

候选列表直接读取搜索页的官方来源标签和字幕组链接，在语言、格式前显示 `官方字幕` 或实际组名，例如 `CMCT字幕组 · 中英双语 · ASS`。两者同时存在时均显示。其他来源及没有来源信息的字幕照常保留，不额外标注；不根据片源标题推断来源，也不额外请求详情页。

## 0.2.0 修复原因

- **搜索误判拦截**：正常搜索页、详情页也包含 Cloudflare 邮件保护和后台检测脚本。旧版根据 `cloudflare` 等关键词拒绝整个页面，导致正常结果无法显示。现在只识别实际验证页标题和验证表单。
- **旧下载接口失效**：`POST /ajax/file_ajax` 已返回 404；当前 `/api/sub/preview/{id}` 返回随机片段的展示文本，缺少原始字幕格式，不能用作完整字幕。
- **HTTP 参数格式不兼容**：[IINA 1.5.0 HTTP 实现](https://github.com/iina/iina/blob/v1.5.0/iina/JavascriptAPIHttp.swift) 只将 `data` 对象转换为表单，旧版传入的字符串被丢弃；当前下载 API 要求 JSON。
- **关键词保留片源噪声**：例如 `Kill.Bill.Vol.2.2004.1080p.BrRIp.x264.YIFY.mp4` 原先变为 `Kill Bill Vol 2 2004 YIFY`，真实站点返回 0 条；提取 `Kill Bill Vol 2` 后站点返回 35 条，插件过滤纯英语结果并按年份、卷号排序。
- **备用设置不生效**：修复留空仍被恢复为默认备用站、下载时漏掉配置主站的问题，并保留 HTTP 状态码信息。

完整下载遵循站点网页当前使用的顺序：访问详情页建立匿名会话 → JSON 调用 `/api/sub/prepare-download` → 访问返回的 `/down/{id}` → JSON 调用 `/api/sub/down` → 下载返回的完整文件。不会把预览片段写成字幕。如果站点拒绝下载或要求额外验证，插件报告失败原因。

## 开发和验证

```sh
node --check main.js
node --test tests/plugin.test.cjs
node scripts/package.cjs
```

开发测试建议使用 Node.js 22 或更新版本，在 macOS 上执行，无 npm 依赖。打包命令生成 `artifacts/SubHD-0.2.1.iinaplgz` 和 `artifacts/SHA256SUMS`，并核对压缩包仅包含插件运行文件和许可证。GitHub Actions 执行语法检查、离线回归测试及打包验证，不访问字幕站点。

可选的真实网络验证：

```sh
node tests/verify-live.cjs
```

该命令会访问真实站点；也可传入影片文件名，例如 `node tests/verify-live.cjs 'Interstellar.2014.1080p.mkv'`。测试适配器模拟 IINA 的 JS API，但网络和系统命令实际执行，测试结束后删除自己的临时文件。

仓库根目录的 `Info.json`、`main.js`、`preferences.html` 是插件源码；`tests/` 包含测试适配器和回归测试，`scripts/` 包含打包脚本。历史本地插件目录、安装包及生成文件不进入 Git。

2026-10-04 验证记录：10 项回归测试通过，覆盖正常 Cloudflare 脚本、真实验证回退、空备用站、可读 HTTP 错误、电影及剧集关键词、JSON 和匿名会话、下载域名校验、无效字幕拒绝，以及带中文、方括号和 shell 字符的 ZIP 文件名、UTF-16 字幕原始字节保留。真实 `subhd.tv` 搜索返回 18 条中文候选，并完成 `UKjGRL` 字幕下载：180,106 字节、1,253 条 ASS 字幕事件。

同日 0.2.0 播放器内验证：IINA 1.5.0 插件管理器显示已安装 0.2.0，已验证的 `main.js` 与 0.2.0 Release 中的运行代码一致。内置字幕候选列表显示 18 条结果；下载的 `subhd-tSQH1y.ass` 已选为主字幕，播放画面实际显示中英双语。

同日 0.2.1 验证：13 项回归测试通过，新增官方来源、其他来源中的字幕组、来源缺失及不从标题推断来源的覆盖。真实搜索页解析得到《杀死比尔》18 条、《星际穿越》20 条中文候选，正确读取官方标签、CMCT、YYeTs 和 F.I.X 组名。IINA 插件管理器显示已安装 0.2.1，原生候选列表中已确认显示 `CMCT字幕组 · 中英双语 · ASS`、`YYeTs字幕组 · 中英双语 · ASS` 和 `官方字幕 · 中英双语 · SRT`。

## 许可证

插件代码使用 [MIT License](LICENSE)。本项目与 IINA、SubHD 无官方关联；字幕文件不包含在仓库或安装包中，其版权归各自权利人所有。
