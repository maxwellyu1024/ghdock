# 任务清单

本文件是所有待处理事项的唯一清单：任务、待确认问题、已知问题。
设计与方案写在 `docs/plans/` 的方案文档中，本文件只记录“要做什么、做到哪了”，通过链接引用方案，不重复方案内容。

维护规则：

- 新增事项时写明来源方案（没有方案的写“无”），完成后勾选并注明提交号。
- 已完成事项保留一段时间供回溯，定期移到文末“已完成”。
- 状态：`[ ]` 未开始 / `[~]` 进行中 / `[x]` 已完成 / `[?]` 待用户确认。

## 方案文档索引

| 方案 | 状态 |
| --- | --- |
| [仓库批量管理与配置导入导出](plans/2026-10-10-repository-management.md) | 已实施，持续改进 |
| [多代码平台、多账号与仓库身份](plans/2026-10-10-multi-platform-accounts.md) | 第 5 步（仓库身份）已实施，其余未实施 |
| [改名 GHDock](plans/2026-10-10-rename-ghdock.md) | 已实施 |
| [独立应用身份](plans/2026-10-10-independent-app-identity.md) | 已实施 |
| [应用名称文案](plans/2026-10-10-app-name-strings.md) | 已实施 |
| [GHDock 图标](plans/2026-10-10-ghdock-icon.md) | 已实施（80eeee4c61 改回 GitHub 原配色、去横条、字母拉高） |
| [Fork CI 与打包](plans/2026-10-10-fork-ci-packaging.md) | 已实施 |
| [无账号时在 GitHub 上查看](plans/2026-10-10-view-on-github-without-account.md) | 已实施 |
| [SSH 主机别名解析](plans/2026-10-02-ssh-host-alias-resolution.md) | 已实施 |
| [仓库菜单“用…打开”](plans/2026-10-02-repository-menu-open-with.md) | 已实施 |
| [仓库列表显示当前分支](plans/2026-10-02-repository-list-current-branch.md) | 已实施 |
| [置顶仓库排序](plans/2026-10-02-pinned-repositories-order.md) | 已实施 |
| [提交列表复制 SHA](plans/2026-10-02-commit-list-sha-copy.md) | 已实施 |
| [置顶仓库设计](plans/2026-07-08-pinned-repositories-design.md) / [计划](plans/2026-07-08-pinned-repositories-plan.md) | 已实施 |

## 进行中

（无）

## 待用户确认

- [?] 新图标（字母纵向拉高 2.5 倍）是否定稿，需在打包后的 Dock 与标题栏中确认。
- [?] 在 GitHub 上为 `maxwellyu1024/ghdock` 开启 Issues（需用户在仓库设置中操作）。

## 待办

### 仓库管理（方案：[仓库批量管理](plans/2026-10-10-repository-management.md)）

- [ ] 替换正式版后回归测试：导入 / 导出配置、管理仓库、从文件夹添加、从其他应用添加、开始页、用编辑器打开。
- [ ] 已登录状态下开始页布局（含教程按钮）目测验证。
- [ ] 管理仓库展开状态修复的目测验证（开发版被正式版打包覆盖，本次用组件测试验证）。
- [ ] “从文件夹添加”分栏弹窗目测验证（需系统选择文件夹对话框，开发版自动化未覆盖）。
- [x] 管理仓库中批量置顶、取消置顶、设置身份，按身份分组（be9a6d9c37）。
- [x] 管理仓库中批量设置别名与清除别名，设为同一别名时警告，可撤销（9b6037944d；方案：[仓库批量管理 · 批量别名](plans/2026-10-10-repository-management.md#批量别名)）。

### 多平台账号与仓库身份（方案：[多代码平台、多账号与仓库身份](plans/2026-10-10-multi-platform-accounts.md#实施顺序)）

- [ ] 第 1 步：平台接口与领域模型，GitHub 实现迁入 `hosting/github/`。
- [ ] 第 2 步：`AccountKey`、账号存储、钥匙串、凭据与数据迁移，同主机多账号。
- [ ] 第 3 步：仓库与账号绑定、远程地址解析（含 GitLab 子组）、凭据助手按绑定选账号。
- [ ] 第 4 步：账号相关界面（偏好设置、登录选平台、克隆、发布、菜单文案）。
- [x] 第 5 步：仓库身份（作者、签名、SSH 别名写入仓库 `.git/config`），含管理仓库批量套用、配置文件 v2
  （103c31c153、ebba87c9d9、01715cc9e0、be9a6d9c37、55fcb67d0e）。身份绑定账号随第 2 步一起做。
- [ ] 仓库身份目测验证（只用开发版，userData `GHDock-dev`）：偏好设置身份页、从现有仓库推荐、仓库设置 Git 配置页、
  列表不一致标记与右键菜单、管理仓库身份分组与批量操作、导出 / 导入 v2 配置。
- [x] 本仓库提交作者确定为 `maxwellyu1024 <abcijkxyz@163.com>`，已写入本仓库本地配置（此前提交保留 `powerpook`，不改写历史）。
- [ ] 在应用中为 `maxwellyu1024` 建身份（作者 `maxwellyu1024 <abcijkxyz@163.com>`，SSH 别名 `maxwellyu1024`）；
  从推荐添加时把作者名由 `abcijkxyz` 改为 `maxwellyu1024`，之后 gachain 系 4 个仓库会显示为未设置好，用一键切换处理。
- [x] 修正“从现有仓库推荐”：按 SSH 别名或本地邮箱聚合，不再把只靠全局配置的克隆聚成一个身份、不再按作者拆出重名身份；
  已用本机 193 个仓库验证（建议 powerpook 36、forgejo 15、maxwellyu1024 7、IBAX 1）。
- [x] 修正 Apply Identities 默认勾选：添加推荐身份后不再默认覆盖仓库已有的作者与远程地址（原先按“用户明确选择”处理）；
  覆盖只在用户为仓库选择身份、或值由同一身份写入时默认勾选；保存身份后只检查身份或身份内容变化的仓库。
  已用本机仓库模拟：添加 4 个推荐身份后 43 个仓库待确认，默认只补写未设置的作者，`jnc` 等已有不同作者的仓库不勾选。
- 仓库身份一键切换与闭环（方案：[仓库身份一键切换与闭环](plans/2026-10-10-identity-switching.md)）：
  - [x] 按 SSH 别名匹配身份（别名优先于规则，身份可无规则）。
  - [x] 一键切换：共用身份菜单、直接写入必需改动、横幅撤销；仓库列表与工具栏右键子菜单，删除 Set Identity 对话框。
  - [x] 推荐时显示后果：每个推荐的补写数、冲突数与冲突仓库。
  - [x] 入口：管理仓库身份菜单按钮与按身份的未设置好分组、偏好设置未设置好数可点击。
  - [x] 入口：提交区身份按钮（操作栏靠右）。
  - [ ] 开发版目测：右键身份子菜单、横幅撤销、管理仓库身份菜单与分组、提交区身份按钮、推荐后果显示。
  - [x] 用本机仓库模拟验证推荐后果与冲突列表（结果见方案文档，冲突仓库与预期一致）。
- [ ] 重新打包正式版：`dist/` 已被清除，之前 beb46f9d9d 的包不存在了；需打包包含批量别名（9b6037944d）与新图标（80eeee4c61）的版本。
- [ ] 用户替换 `/Applications/GHDock.app` 为重新打包的 `dist/GHDock-darwin-arm64/GHDock.app`（未签名）。
- [ ] 第 6 步：GitLab 实现。
- [ ] 第 7 步：Gitea / Forgejo 实现。
- [ ] 第 8 步：Bitbucket Cloud 实现。

## 已知问题

- 单元测试 “parses files from pull error” 在本机失败：本机全局 `pull.rebase` 配置导致，与代码无关，暂不处理。

## 已完成

- [x] Ubuntu 本地编译打包跑通（2026-10-11，Ubuntu 26.04 x64）：`yarn install` → `GITHUB_ACTIONS=false yarn build:prod` →
  `GITHUB_ACTIONS=false yarn package`，产出 `dist/ghdock_3.6.7~beta3_amd64.deb`（Electron 44.1.1）。
  环境与步骤见方案文档“本地 Ubuntu 构建”。附带修复：`playwright` 与 `@playwright/test` 版本不一致
  （1.64.0 / 1.58.2）导致 webpack 编译 `app/test/e2e/e2e-fixtures.ts` 时两份 `playwright-core` 类型冲突，
  已把 `@playwright/test` 一并对齐到 `^1.64.0`。
- [x] 修复 deb 安装后普通用户无法运行：Electron 解压产物根目录 `0700` 被 `cpSync` 原样带入，
  `/opt/ghdock` 装出后是 `drwx------`（2026-10-11 本机安装后点击无反应发现）。
  `package-linux.ts` staging 后对应用根目录 `chmod 0755`，重新打包；本机因 dpkg 不重设已有目录权限，
  手动 `sudo chmod 755 /opt/ghdock`。已用 `gtk-launch ghdock` 验证可正常启动。

- [x] 移除对旧版 “GitHub Desktop Pinned” 的兼容：不迁移数据、不作为“从其他应用添加”的来源（旧数据目录应用不再读取，也不修改）。
- [x] 主窗口与崩溃窗口标题改为产品名（取自 `app/package.json` 的 `productName`），不再显示 “GitHub Desktop”。
- [x] 管理仓库对话框改版（方案：[仓库批量管理 · 分栏选择列表 / 批量管理](plans/2026-10-10-repository-management.md#分栏选择列表)）：
  左侧按状态与“主机 → 用户或组织”分组、对话框随窗口缩放、Shift 连选、已选数量、
  可选“同时移到废纸篓”（红色提示）；“从其他应用添加”“从文件夹添加”共用分栏组件（提交见 git log）。
- [x] 开始页按钮分为“本机添加”与“克隆或新建”两组，统一样式（8a7dda2c18）。
- [x] 开始页内容区宽度与最小窗口显示修复，勾选列表行距收紧（c6556ea76a）。
- [x] 从其他应用添加：只添加当前来源中勾选的仓库，按钮数量与列表一致（502fb52e62）。
- [x] 多代码平台、多账号方案及仓库身份方案（1ad6523813、c929562ead）。
