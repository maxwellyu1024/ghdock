# GHDock 应用图标

## 设计

沿用 GitHub Desktop 原来的配色，图案为白色大写字母 “GHD”，不加其他装饰：

- 正式版：紫色渐变底（Display P3 `0.568, 0.258, 0.760` → sRGB `#5a1087`，扁平图标为 `#9c3cc9` → `#5a1087`），白色字母。
- 开发版：黄色渐变底（Display P3 `0.969, 0.765, 0.075` → sRGB `#e9b500`，扁平图标为 `#ffc000` → `#e9b500`），
  白色字母；深色模式下字母为黄色。
- `icon.json` 沿用 GitHub Desktop 原文件的材质与透明度设置，只把前景图层换成 `GHD.svg`，开发版去掉网格背景层。
- 字母纵向拉高为原字形的 2.5 倍比例：扁平图标宽 600、高 528（底板 896），Icon Composer 图层宽 660、高 581。

字母由 Helvetica Neue Bold 转为路径，SVG 不依赖任何字体。

## 源文件

| 文件 | 用途 |
| --- | --- |
| `app/static/logos/{prod,dev}/icon-logo.svg` | 扁平图标，渲染 Windows / Linux / 关于对话框的位图 |
| `app/static/logos/{prod,dev}/icon-logo.icon` | Icon Composer 图标（`Assets/GHD.svg` + `icon.json`），编译 macOS 26 的 Liquid Glass 图标 |
| `app/static/logos/win32-installer-splash.svg` | Windows 安装启动画面 |

## 生成

`script/build-icon-assets.sh`（需要 Xcode 与 `rsvg-convert`）由源文件生成全部产物：

- macOS：`Assets.car`、`icon-logo-legacy.icns`（actool）；actool 使用绝对路径编译，
  避免沿用上一个目录导致开发版与正式版图标相同。
- Windows：`icon-logo.ico`（16–256 共 7 个尺寸）、`win32-installer-splash.gif`。
- Linux：`app/static/linux/icon-logo.png`（512）。
- 关于对话框：`app/static/common/logo-64x64@2x.png`、`windows-logo-64x64@2x.png`（128）。

Windows “程序和功能”的图标（Squirrel `iconUrl`）在 fork 构建中指向仓库内的
`app/static/logos/prod/icon-logo.ico`，GitHub Actions 中固定到构建提交。

## 窗口标题栏

Windows 自绘标题栏左上角的应用标识由 GitHub 章鱼猫换为 `appMark`
（`app/src/ui/octicons/app-mark.ts`）：同样纵向拉高的 “GHD” 字母，占满 16px 高度，
沿用标题栏的前景色与失焦半透明效果。Linux 使用系统标题栏，窗口图标为 `icon-logo.png`。
