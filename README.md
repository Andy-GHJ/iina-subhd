# IINA SubHD

简体中文 | [English](README.en.md)

在 IINA 内置的在线字幕搜索中查找、下载并加载 SubHD 中文字幕和中英双语字幕。

- 显示官方字幕标签、字幕组名称、语言、格式和下载次数。
- 根据影片名称、年份和剧集编号匹配字幕。
- 支持 SRT、ASS、SSA、VTT，以及 ZIP、RAR、7z 中的字幕，保留原始编码。

适用于 macOS，已在 IINA 1.5.0 验证，无需额外安装运行依赖。

## 安装

在 IINA 插件管理器中使用以下 GitHub 地址安装：

```text
https://github.com/Andy-GHJ/iina-subhd
```

也可从 [Releases](https://github.com/Andy-GHJ/iina-subhd/releases) 下载 `.iinaplgz` 安装包，选择“安装本地插件…”安装。

## 使用

1. 在 IINA 字幕设置中，将在线字幕提供方设为 **SubHD 中文字幕**。
2. 播放影片，选择“字幕 → 在线查找字幕”，选择匹配的字幕并下载。

插件偏好设置默认主站为 `https://subhd.tv`，备用站为 `https://subhd.me`。备用站留空可关闭回退。

## 开发

需要 macOS 和 Node.js 22 或更新版本，无 npm 依赖。

```sh
node --test tests/plugin.test.cjs
node scripts/package.cjs
```

安装包输出至 `artifacts/`。可选的真实网络验证：`node tests/verify-live.cjs`。

## 许可证

[MIT](LICENSE)。本项目与 IINA、SubHD 无官方关联；字幕版权归各自权利人所有。
