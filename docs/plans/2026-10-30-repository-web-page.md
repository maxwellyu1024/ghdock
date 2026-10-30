# 在代码平台网页上查看仓库（含自建实例）

## 背景

[View on GitHub 不依赖登录账号](2026-10-10-view-on-github-without-account.md) 只认 github.com：
`getRemoteWebURL` 遇到其他主机返回 `null`，所以内部 Forgejo、GitLab 等仓库的 “View on GitHub”
全部置灰。

SSH 远程推不出网页地址。例如 `git@forgejo:yw/ghdock.git` 的别名 `forgejo` 解析到
`192.168.124.11`，SSH 走 2222 端口，但网页在 `http://192.168.124.11:3000`。协议和端口都只能靠探测或用户填写才能知道。

## 目标

- 4 个入口对非 GitHub 仓库都可用，误判置灰为 0：仓库列表右键菜单、工具栏仓库按钮右键菜单、
  应用菜单 `view-repository-on-github`、无改动页建议操作。
- 文案按平台显示：“View on GitHub / GitLab / Gitea / Forgejo / Bitbucket / Gitee”，
  平台未知时显示 “View on Web”。
- 自建实例首次使用时自动探测，结果按主机持久化，之后不再重复探测。
  用户可以在偏好设置中查看、修改、删除、重新探测每个主机的网页地址。
- 已关联 GitHub 仓库时行为不变（`getGitHubHtmlUrl` 优先）。

## 设计

本方案是 [多代码平台方案](2026-10-10-multi-platform-accounts.md) 中 `IHostingProvider.detect` 与
`IHostingClient.webUrls` 的“仓库主页”部分，不依赖账号。平台层落地后，探测与平台名都并入 provider。

### 平台（`app/src/lib/hosting/hosting-platform.ts`）

- `HostingPlatform = 'github' | 'gitlab' | 'gitea' | 'forgejo' | 'bitbucket' | 'gitee'`。
  `getHostingPlatformName(platform | null)` 返回界面名，`null` 返回 `Web`。
- 已知 SaaS 主机表：
  - `github.com` → GitHub；
  - `gitlab.com` → GitLab；
  - `codeberg.org` → Forgejo；
  - `bitbucket.org` → Bitbucket；
  - `gitee.com` → Gitee。

  这些主机的网页地址固定为 `https://<host>`。

### 远程地址 → 仓库网页（`app/src/lib/repository-web-url.ts`）

1. 解析远程地址，得到主机和完整路径，支持以下写法：
   - `http(s)://[user@]host[:port]/path`；
   - `ssh://[user@]host[:port]/path`；
   - `git://host/path`；
   - scp 写法 `[user@]host:path`。

   路径保留多级（GitLab 子组），去掉首尾 `/` 和 `.git`，至少要有两段。
   SSH 主机经 `sshHostAliasResolver` 解析成真实主机名。
2. 按以下顺序确定网页源（origin），找到即停：
   1. 主机网页地址表中该主机的记录（用户填写或探测所得）；
   2. 已知 SaaS 表；
   3. HTTPS 远程用远程自身的协议、主机和端口。
3. 网页地址为 `<origin>/<path>`，结果为 `{ url, platform }`。都不满足时返回 `null`。

### 主机网页地址表（`app/src/lib/hosting/hosting-web-origin-store.ts`）

- 记录结构：`{ host, origin, platform, source: 'detected' | 'user' }`，以真实主机名为键，
  存在 localStorage `hosting-web-origins` 中，变化时发出更新事件。
- `resolve(host, candidates)`：主机已有记录、在已知 SaaS 表中、或本次会话已探测失败时直接返回。
  否则执行探测，同一主机的并发请求合并为一次。成功则写入 `detected` 记录。
  失败只记在内存，下次启动再试。
- 自动探测不会覆盖用户的记录（`user`）。“重新探测”成功时替换原记录，失败时保留原记录。

### 探测（主进程，`app/src/main-process/detect-hosting-web-origin.ts`）

- 在主进程用 Electron `net.fetch` 发请求：走系统代理与证书设置，也不受渲染进程 CORS 限制。
  通过 IPC `detect-hosting-web-origin(candidates)` 调用，只接受 `http(s)` 源。
- 候选源：
  - SSH 远程依次试 `https://host`、`http://host`、`http://host:3000`（Gitea / Forgejo 默认端口）；
  - HTTPS 远程只试远程自身的源。
- 每个候选源并行请求以下接口，单个请求超时 3 秒：
  - `/api/v1/version`：返回 JSON `version` 即为 Gitea；`version` 含 `+gitea-` 时为 Forgejo；
  - `/api/forgejo/v1/version`：成功即为 Forgejo；
  - `/api/v4/version`：带 `X-Gitlab-Meta` 头，或 401 响应体是 `401 Unauthorized`，即为 GitLab；
  - `/api/v3/meta`：返回 JSON `installed_version` 即为 GitHub Enterprise Server。
- 根路径与平台接口同时请求；所有候选源都认不出平台时，取第一个根路径返回 2xx 的源，平台记为 `null`（显示 “View on Web”）。
  全部失败时返回 `null`。

### 触发时机

- 右键菜单：`AppStore._getRepositoryWebPage` 先读远程，再 `await` 主机解析，然后计算网页。
  所有候选源的探测请求并行发出，第一次右键最多等待一个超时（3 秒）。
- 选中仓库：远程更新时在后台发起解析。地址表更新后重新计算菜单状态与菜单文案，并刷新界面。

### 界面

- 仓库右键菜单（列表与工具栏）：配置项改为 `webPage: IRepositoryWebPage | null`，
  文案为 `View on <平台名>`；`null` 时显示置灰的 “View on Web”。
- 应用菜单：`MenuLabelsEvent.repositoryWebPlatformName`，标签为 `View on <平台名>`，
  默认 `GitHub`。
- 无改动页：说明文字为 `Open the repository page on <平台名> in your browser`。
- 偏好设置 · Integrations 新增 “Repository web pages” 区域：
  - 每行显示主机、网页地址、平台、来源（Detected / Custom），可编辑、重新探测、删除；
  - 底部可新增记录：主机、网页地址（必须是 `http(s)` 源）、平台（下拉，含 Unknown）；
  - 修改立即保存。

## 测试

- `repository-web-url-test.ts`：
  - github.com 的 HTTPS 与 SSH 远程，SSH 别名；
  - 已知 SaaS；
  - GitLab 子组；
  - HTTPS 自建实例（带端口）；
  - SSH 自建实例无记录时为 `null`，有记录时使用记录；
  - 用户记录覆盖已知 SaaS；
  - 已关联仓库优先。
- `hosting-web-origin-store-test.ts`：
  - 持久化读写；
  - 探测成功写入、失败不重复探测；
  - 并发合并；
  - 用户记录不被覆盖；
  - 重新探测。
- `detect-hosting-web-origin-test.ts`（假 fetch）：
  - Forgejo（`+gitea-` 与 forgejo 接口）、Gitea、GitLab、GHES；
  - 候选源顺序；
  - 无平台时退回根路径；
  - 全部失败。
- `repository-list-item-context-menu-test.ts`：平台文案、`null` 时置灰。
- 手动（开发版）：右键内部 Forgejo 仓库打开 `http://192.168.124.11:3000/yw/ghdock`，
  菜单显示 “View on Forgejo”；偏好设置中修改与删除记录。
