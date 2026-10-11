# fork 自动打包：macOS / Windows / Ubuntu

## 目标

推送 `development` 后，GitHub Actions 自动产出 3 个平台的安装包，无需任何证书或密钥：

| 平台 | Runner | 架构 | 产物 |
| --- | --- | --- | --- |
| macOS | `macos-14` | arm64 | `<productName>-arm64.zip`（ad-hoc 签名） |
| Windows | `windows-2022` | x64 | `<WindowsId>Setup-x64.exe`、`<WindowsId>Setup-x64.msi`（未签名） |
| Ubuntu | `ubuntu-22.04` | x64 | `<cliName>_<version>_amd64.deb` |

产物上传为 Actions 构建产物，并滚动更新预发布版本 `development-latest`。
fork 只保留 `fork-package.yml`。上游工作流（CI、CodeQL、triage、release）及其专用配置
（`.github/codeql`、`.github/aw`、`.github/actions/setup-windows-signing`）已删除：
它们依赖上游的签名证书与密钥，在 fork 中无法运行。合并上游时这些文件若有改动，
冲突一律按删除处理（`git rm`）。

登录用的 OAuth App 为可选配置：在仓库 Secrets 中同时设置 `DESKTOP_OAUTH_CLIENT_ID`、
`DESKTOP_OAUTH_CLIENT_SECRET`（回调地址 `x-github-desktop-auth://oauth`）后，打包版使用
自有 OAuth App；未设置时回退到上游公开的开发用 OAuth App，回调协议为
`x-github-desktop-dev-auth`。构建、打包、运行时三处的协议选择保持一致。

## Windows 独立身份

此前 Windows 标识沿用官方的 `GitHubDesktop`，Squirrel 会安装到
`%LOCALAPPDATA%\GitHubDesktop` 并覆盖官方应用，CLI `github` 也会冲突。终态：

- `getWindowsIdentifierName()` 移入 `app/package-info.ts`：官方构建为 `GitHubDesktop`，
  fork 由 `productName` 去掉非字母数字得到（`GHDock`），改名时自动跟随。
- 可执行文件、Squirrel 包名、安装目录、AppUserModelID
  （`com.squirrel.<id>.<id>`）全部使用该标识；通过 `__WINDOWS_IDENTIFIER__` 注入运行时。
- `cli/main.ts` 按标识启动 `<id>.exe`；`static/win32/github.{bat,sh}` 中的
  `GitHubDesktop.exe` 在构建时替换为 `<id>.exe`。
- Squirrel 写入 `bin` 的 CLI 跳板使用 `__CLI_NAME__`（`ghdock`），与官方 `github` 并存。
- 增量包（delta）仅官方构建生成，fork 不再拉取官方更新源做差分。

## Ubuntu 打包

- 可执行文件名：官方 `desktop`，fork 使用 `getCLIName()`（`ghdock`）。
- `script/package-linux.ts` 用 `dpkg-deb --root-owner-group` 生成 `.deb`，零新增依赖：
  - `/opt/<name>/`：打包后的应用；`chrome-sandbox` 设为 `4755`，满足 Ubuntu 24.04 的沙箱要求；
  - `/usr/bin/<name>` → `/opt/<name>/<name>`；
  - `/usr/share/applications/<name>.desktop`，含 OAuth 回调协议的 `x-scheme-handler`；
  - `/usr/share/icons/hicolor/512x512/apps/<name>.png`；
  - `DEBIAN/control`：版本号 `3.6.7-beta3` 转为 `3.6.7~beta3`，声明 Electron 运行依赖。
- 在 `ubuntu-22.04` 上构建，glibc 兼容 22.04 与 24.04；构建前安装 `libsecret-1-dev`（keytar）。

## 本地 Ubuntu 构建

2026-10-11 在 Ubuntu 26.04 x64 上验证通过的完整步骤（CI 之外的本地路径）：

1. 系统依赖：`sudo apt-get install -y libsecret-1-dev build-essential pkg-config`
   （`libsecret-1-dev` 供 keytar 编译，`dpkg-deb` 打包工具 Ubuntu 自带）。
2. Node 与 yarn：nvm 安装的 Node 26.11.1 + 全局 `yarn@1.21.1`（与 `vendor/yarn-1.21.1.js` 同版本）。
   CI 用 Node 24.19.0，本地 26 亦可用；nodejs.org 在该机器不可达时 nvm 装不了新版本，用已装版本即可。
3. 仓库根目录 `yarn install`（post-install 会安装 app 依赖、下载 Electron、初始化子模块、编译 `script/`）。
4. `GITHUB_ACTIONS=false yarn build:prod`：webpack 生产编译 + electron-packager，产物在 `dist/ghdock-linux-x64/`。
5. `GITHUB_ACTIONS=false yarn package`：产出 `dist/ghdock_<version>_amd64.deb`。

注意：`playwright` 与 `@playwright/test` 必须同版本，否则两份 `playwright-core` 的类型会让
`app/test/e2e/e2e-fixtures.ts` 在 `compile:prod` 阶段报 TS2345（当前统一为 `^1.64.0`）。
本地构建产生的 deb 链接的是本机 glibc，如需分发给 22.04/24.04 用户请使用 CI（`ubuntu-22.04`）产物。

打包坑：Electron 解压产物根目录（`dist/<name>-linux-x64/`）权限是 `0700`，`cpSync` 会原样带进
staging，装出来的 `/opt/<name>` 普通用户无法进入（表现为点击图标无反应 / Permission denied）。
`package-linux.ts` 在 staging 后对应用根目录 `chmod 0755` 修复。注意 dpkg 重装同一版本时
不会重设已存在目录的权限，旧机器升级后需手动 `sudo chmod 755 /opt/<name>`（全新安装不受影响）。

## 验证

- 本地：`tsc`、eslint、`dist-info`/`package-info` 相关单元测试。
- CI：3 个平台任务全部成功，`development-latest` 包含 4 个安装文件。
- 本地 Ubuntu 26.04：build:prod + package 产出 deb；`dpkg-deb -I/-c` 校验元数据、SUID `chrome-sandbox`、
  desktop 文件与图标齐全；`ldd` 无缺失动态库，打包后二进制可启动。
