# IINA SubHD

[简体中文](README.md) | English

Search, download, and load Chinese and bilingual subtitles from SubHD using IINA's built-in online subtitle search.

- Displays labels for official subtitles, subtitle group names, language, format, and download counts.
- Matches subtitles by title, year, and episode number.
- Supports SRT, ASS, SSA, VTT, and subtitles inside ZIP, RAR, and 7z archives while preserving the original encoding.

For macOS. Tested with IINA 1.5.0. No additional runtime dependencies.

## Installation

Install from this GitHub URL using IINA's plugin manager:

```text
https://github.com/Andy-GHJ/iina-subhd
```

Alternatively, download the `.iinaplgz` package from [Releases](https://github.com/Andy-GHJ/iina-subhd/releases) and install it as a local plugin.

## Usage

1. Select **SubHD 中文字幕** as the online subtitle provider in IINA's subtitle settings.
2. Start playback, open the online subtitle search, and select a matching subtitle to download.

The plugin preferences default to `https://subhd.tv` as the primary site and `https://subhd.me` as the fallback. Leave the fallback empty to disable it.

## Development

Requires macOS and Node.js 22 or later. No npm dependencies.

```sh
node --test tests/plugin.test.cjs
node scripts/package.cjs
```

Packages are written to `artifacts/`. Optional live network check: `node tests/verify-live.cjs`.

## License

[MIT](LICENSE). This project is not affiliated with IINA or SubHD. Subtitle copyrights belong to their respective owners.
