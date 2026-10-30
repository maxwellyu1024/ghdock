# 多代码平台、多账号与仓库身份

状态：方案，未实施。

## 目标

- 支持 GitHub（GitHub.com、GitHub Enterprise Server、GHE.com）、GitLab（GitLab.com 与自建）、
  Gitea / Forgejo（含 Codeberg）、Bitbucket Cloud 四类平台，新增平台只需新增一个平台实现模块。
- 任意数量账号同时登录，同一平台、同一主机也可登录多个账号（如两个 GitHub.com 账号）。
- 每个仓库明确绑定一个账号；拉取、推送、PR、CI 状态都使用该账号。
- 界面文案与流程不绑定具体平台：平台名称来自平台实现，能力缺失时对应界面不显示。
- 每个仓库有明确的“身份”：提交作者（`user.name` / `user.email` / 签名密钥）、SSH 主机别名、
  平台账号三者一起，按规则自动套用，并写入仓库自身的 `.git/config`，终端、编辑器等任何 Git 客户端
  都使用同一身份，信息跟着仓库目录走。

终态指标：

| 指标 | 终态 |
| --- | --- |
| 以 endpoint 作为账号唯一标识的代码位置 | 0 |
| 平台实现模块之外直接构造 `API` / 调用 GitHub REST 的位置 | 0 |
| 平台实现模块之外调用 `isDotComAccount` / `isEnterpriseAccount` 做平台判断的位置 | 0 |
| 同一主机可同时登录的账号数 | 不限 |
| 嵌套命名空间（GitLab 子组 `group/sub/repo`）解析失败的远程地址 | 0 |
| 升级后丢失的账号、令牌、仓库关联 | 0 |
| 匹配到身份的仓库中，`.git/config` 的作者、远程地址与身份不一致且未提示的仓库 | 0 |
| 未经确认被覆盖的仓库已有 `user.*` 或远程地址 | 0 |
| 写入全局 Git 配置或 `~/.ssh/config` 的位置 | 0 |

## 现状（2026-10-10 调研）

- `Account` 没有平台字段，GitHub.com 与 Enterprise 由 URL 推断；`AccountsStore`、`CredentialSessions`、
  钥匙串键、`getAccountForEndpoint`、`matchGitHubRepository`、`findGitHubTrampolineAccount` 都以
  endpoint 为账号标识，每个主机只能有一个账号，登录同主机新账号会移除旧账号。
- `lib/api.ts`（约 2500 行）是 GitHub REST/GraphQL 客户端，约 80 个文件引用；OAuth 只有一个 GitHub
  OAuth App，回调协议 `x-github-client://oauth`。
- 仓库与账号的关联靠远程地址主机名推断，未持久化；`remote-parsing.ts` 只支持 `owner/name`。
- 数据：localStorage `users`；钥匙串 `"<prefix> - <endpoint>"`；Dexie `owners`、`gitHubRepositories`、
  `repositories.gitHubRepositoryID`、`protectedBranches`；`PullRequestDatabase`、`IssuesDatabase`、
  `GitHubUserDatabase`。
- 非 GitHub 主机已可通过通用凭据（每主机一个用户名，密码在钥匙串）完成 Git 操作。
- 仓库设置已有 Git Config 页（`ui/repository-settings/git-config.tsx`），可在“使用全局配置”与
  “使用本仓库配置”之间切换并填写本仓库的用户名、邮箱；`remote-parsing.ts` 的
  `resolveRemoteHostAliases` 已能把 SSH 别名解析为真实主机用于匹配。
- 常见问题：全局 `user.*` 是一个身份，通过另一个 SSH 别名推送的仓库提交作者仍是全局身份。

## 架构

### 平台与能力

```ts
type ProviderKind = 'github' | 'gitlab' | 'gitea' | 'bitbucket'

interface IHostingProvider {
  readonly kind: ProviderKind
  readonly displayName: string            // "GitHub"、"GitLab"…，界面文案统一取这里
  detect(host: URL): Promise<IHostInfo | null>   // 自建实例探测与版本
  readonly auth: IProviderAuth
  createClient(account: Account): IHostingClient
}

interface IHostingClient {
  readonly capabilities: ReadonlySet<Capability>
  identity: IIdentityApi                   // 当前用户、邮箱、组织/群组
  repositories: IRepositoryApi             // 列表、详情、克隆信息、创建（发布）、fork
  pullRequests?: IPullRequestApi           // GitHub PR / GitLab MR / Gitea PR / Bitbucket PR
  checks?: IChecksApi                      // 提交状态、流水线、重新运行
  issues?: IIssuesApi                      // 自动补全：issue、提及
  branchRules?: IBranchRulesApi            // 保护分支、推送规则
  liveUpdates?: ILiveUpdatesApi            // 仅 GitHub alive
  webUrls: IWebUrls                        // 仓库、提交、分支比较、新建 PR 的网页地址
}
```

- 仓库主页地址与自建实例探测已先行落地，不依赖账号，见
  [在代码平台网页上查看仓库](2026-10-30-repository-web-page.md)：`lib/hosting/hosting-platform.ts`
  （平台名、已知 SaaS）、`hosting-web-origin-store.ts`（按主机持久化的网页地址）、主进程
  `detect-hosting-web-origin.ts`（探测）。第 1 步把它们并入 `IHostingProvider.detect` 与 `webUrls`。
- `app/src/lib/hosting/<kind>/` 每个平台一个目录；现有 `lib/api.ts`、`endpoint-capabilities.ts`、
  Copilot 相关代码移入 `hosting/github/`，Copilot 为 GitHub 独有能力。
- 各 store（`pull-request-store`、`commit-status-store`、`issues-store`、`api-repositories-store`…）
  只依赖 `IHostingClient` 接口，按 `capabilities` 决定是否工作。
- 统一领域模型：`HostedRepository`、`Namespace`（替代 `Owner`，支持多级路径）、`PullRequest`、
  `CheckRun`、`Mentionable`；平台差异在平台模块内转换。

### 账号

```ts
interface AccountKey {
  readonly provider: ProviderKind
  readonly apiEndpoint: string   // 规范化后的 API 地址
  readonly userId: string        // 平台用户 ID（字符串，兼容各平台）
}
```

- `Account` 增加 `provider`，以 `AccountKey` 为唯一标识；同主机多个账号并存。
- `AccountsStore` 持久化键改为 `accounts`（新格式），按 `AccountKey` 增删改；排序按平台、主机、登录名。
- 钥匙串服务名：`"<prefix> - <provider> - <apiEndpoint>"`，钥匙串账号名为 `userId`。
- `CredentialSessions` 的租约、刷新、吊销以 `AccountKey` 为键。

### 登录

| 平台 | 方式 |
| --- | --- |
| GitHub | 现有 OAuth 浏览器流程；Enterprise 输入主机 |
| GitLab | OAuth 2.0 + PKCE（GitLab.com 内置应用；自建实例填写应用 ID，或使用个人访问令牌） |
| Gitea / Forgejo | OAuth 2.0 + PKCE（实例上注册的应用）或个人访问令牌 |
| Bitbucket Cloud | OAuth 2.0 或 App Password / API Token |

- 回调统一为 `x-ghdock-client://oauth/<provider>`，`state` 中包含平台与主机，防 CSRF 校验沿用现有逻辑。
- 登录界面第一步选择平台，再选择 SaaS 或输入自建主机；令牌方式作为每个平台的备选。
- OAuth 客户端信息按平台在构建时注入（`__OAUTH_<PROVIDER>_CLIENT_ID__`），自建实例由用户填写并随账号保存。

### 仓库与账号绑定

- `repositories` 增加 `accountKey`（可空）；`gitHubRepositories` 更名为 `hostedRepositories`，
  增加 `provider`、`fullPath`（多级命名空间）、`namespaceID`；`owners` 更名为 `namespaces`。
- 绑定规则，按顺序：
  1. 已绑定且账号仍存在 → 使用；
  2. 远程主机下只有一个账号 → 自动绑定；
  3. 多个账号 → 依次以各账号请求仓库详情，首个有权限的账号绑定，均有权限时选推送权限最高者；
  4. 无账号 → 不绑定，Git 操作走通用凭据。
- 仓库设置新增“账号”选项，可手动更换绑定。
- `remote-parsing.ts` 解析为 `{protocol, hostname, fullPath, name}`，支持任意层级命名空间与
  GitLab `/-/` 路径、Bitbucket `scm/` 前缀、SSH 别名。

### Git 凭据

- 启动 Git 时通过 trampoline 环境变量传入仓库绑定的 `AccountKey`；凭据助手优先使用该账号，
  其次按 `origin + username` 匹配账号，再按主机唯一账号匹配，最后走通用凭据。
- 各平台的 HTTPS 用户名约定由平台实现提供（GitHub 用 login，GitLab 用 `oauth2`，Bitbucket 用
  `x-token-auth`）。
- 通用凭据改为每主机多个用户名，与账号使用同一钥匙串命名规则。

### 仓库身份

```ts
interface IIdentity {
  readonly id: string
  readonly label: string                    // 例如 "maxwellyu1024"
  readonly authorName: string               // user.name
  readonly authorEmail: string              // user.email
  readonly signing?: {                      // 可选，写入 user.signingkey / gpg.format / commit.gpgsign
    readonly format: 'openpgp' | 'ssh' | 'x509'
    readonly key: string
  }
  readonly sshHostAlias?: string            // ~/.ssh/config 中的 Host，如 "maxwellyu1024"
  readonly account?: AccountKey             // 可选，绑定的平台账号（第 2 步 AccountKey 落地后加入）
  readonly rules: ReadonlyArray<IIdentityRule>
}

// 仓库如何选择身份，保存在仓库数据的 identity 字段
type RepositoryIdentityBinding =
  | { kind: 'automatic' }                   // 按默认远程地址匹配规则（默认值）
  | { kind: 'none' }                        // 不使用身份，不检查也不写入本地配置
  | { kind: 'identity'; id: string }        // 手动指定，优先于规则

interface IIdentityRule {
  readonly host: string                     // 真实主机，如 "github.com"（别名先解析为真实主机）
  readonly namespace?: string               // 命名空间前缀，如 "maxwellyu1024"，支持多级 "group/sub"
}
```

- 身份保存在应用数据中（不含密钥内容，只保存密钥 ID 或公钥路径），随配置文件导出导入。
- 仓库匹配：取默认远程地址，SSH 别名用 `ssh -G <alias>` 解析为真实主机，再按
  “主机 + 最长命名空间前缀”匹配规则；也可在仓库设置中手动指定身份，手动指定优先。
- 仓库数据增加 `identity`（上述三态绑定），与 `accountKey` 一起表示仓库绑定；身份绑定了账号时，
  `accountKey` 取身份的账号。删除身份时，指定该身份的仓库回到 `automatic`。

写入仓库配置（只写 `git config --local`）：

| 键 | 值 |
| --- | --- |
| `user.name` / `user.email` | 身份的作者信息 |
| `user.signingkey`、`gpg.format`、`commit.gpgsign` | 身份设置了签名时 |
| `remote.<默认远程>.url` | 身份设置了 SSH 别名时改写为 `git@<alias>:<fullPath>.git`；HTTPS 远程只在用户选择“改用 SSH”时改写 |
| `ghdock.identity` | 身份 ID，用于识别由本应用写入的配置，便于检查与更新 |

规则：

- 套用时机：克隆、添加已有仓库、从文件夹添加、从其他应用添加、导入配置、在仓库设置中更换身份、
  修改身份内容后对其全部仓库重新套用。
- 仓库已有不同的 `user.*` 或远程地址时，不直接覆盖：在确认对话框里逐项列出差异（当前值 → 新值），
  确认后才写入。默认勾选：补写未设置的值；覆盖已有值只在两种情况下默认勾选——用户为这些仓库
  明确选择了身份（仓库设置、设置身份、重新套用），或被覆盖的值是该身份此前写入的（`ghdock.identity`
  等于该身份，如修改身份内容后）。由规则匹配产生的检查（添加、推荐、排序、删除身份，添加或导入仓库）
  不默认覆盖其他来源的值；“改用 SSH”从不默认勾选。
- 保存身份后只检查受影响且不一致的仓库：所用身份变了，或所用身份的内容变了。
- 改写远程地址前校验：别名经 `ssh -G` 解析出的 `hostname` 必须等于原远程主机，`fullPath` 不变；
  不满足时跳过并提示原因。
- 身份检查：打开仓库与刷新时比较 `.git/config` 与身份，不一致时在仓库列表项与仓库设置中提示，
  提供“重新套用”与“改为不使用身份”两个操作。
- 不写全局 Git 配置，不修改 `~/.ssh/config`；身份编辑器中只读列出 `~/.ssh/config` 的 `Host` 供选择。
- 从现有仓库推断身份建议（排除已有身份与设为不使用身份的仓库），只依据仓库上有意做出的设置：
  - 远程使用 SSH 别名的仓库按“真实主机 + 别名”聚合；作者取组内最多的本地 `user.email` 及对应 `user.name`，
    组内都没有本地配置时取全局作者。与之不同的仓库在创建身份后显示为未设置好，由用户逐个确认。
  - 其他仓库按“真实主机 + 本地 `user.email`”聚合，且只在本地邮箱不同于全局邮箱时建议；
    只靠全局配置的仓库不需要身份，不产生建议。
  - 每组的规则为组内各顶级命名空间；名称取别名，否则取唯一的命名空间，否则取邮箱，重名时加序号。
  - 列出建议的身份与规则，用户确认后创建。
- “不一致”定义：仓库有身份，且套用该身份会产生必需改动（`ghdock.identity` 标记之外的差异）。

实现模块：

| 模块 | 职责 |
| --- | --- |
| `models/identity.ts` | 身份、规则、三态绑定 |
| `lib/identity/remote-location.ts` | 远程地址解析（含多级命名空间） |
| `lib/identity/match-identity.ts` | SSH 别名解析为真实主机后，按绑定与规则选身份（最长命名空间前缀） |
| `lib/identity/identity-changes.ts` | 计算本地配置差异、写入所选改动 |
| `lib/identity/identity-rules.ts` | 规则文本格式 `host` / `host/namespace` 的解析与格式化 |
| `lib/identity/infer-identities.ts` | 从现有仓库推断身份建议 |
| `lib/identity/repository-identity.ts` | 读取仓库本地配置，得出所用身份与差异 |
| `lib/identity/repository-identity-tracker.ts` | 后台跟踪每个仓库的身份状态，供列表标记与分组 |
| Dexie `identities` 表 | 身份按优先级顺序保存 |

配置文件 v2（读取 v1 与 v2，写出 v2）：

```json
{
  "version": 2,
  "identities": [
    { "label": "Work", "authorName": "Me", "authorEmail": "me@work.example", "signing": {"format":"ssh","key":"~/.ssh/work.pub"}, "sshHostAlias": "github-work", "rules": ["github.com/acme"] }
  ],
  "repositories": [
    { "path": "~/dev/a", "identity": "Work" },
    { "path": "~/dev/b", "identity": null },
    { "path": "~/dev/c" }
  ],
  "settings": {}
}
```

- 身份按 `label` 标识（不区分大小写、不可重复）；仓库的 `identity` 必须是文件中某个身份的 label，
  `null` 表示不使用身份，省略表示自动匹配。文件没有 `identities` 段（如 v1）时，省略 `identity`
  的仓库保持现有绑定。
- 导入：身份按 label 合并，已有身份保留 ID；文件中的身份排在前面，合并模式下其余身份按原顺序随后，
  “与文件一致”模式删除文件中没有的身份。先保存身份，再添加仓库、设置别名 / 置顶 / 身份，
  最后对涉及的仓库复核本地配置差异；导入了设置时，复核对话框关闭后再重新加载窗口。

### 界面

| 位置 | 终态 |
| --- | --- |
| 偏好设置 · 账号 | 按平台分组列出所有账号，“添加账号”先选平台；每个账号可退出、重新登录 |
| 空仓库页 | 左栏账号选择器显示“平台图标 · 主机 · 登录名”，列出所选账号仓库 |
| 克隆 | 两个标签：“Your Accounts”（账号选择器 + 仓库列表）与 “URL”；不再区分 GitHub.com / Enterprise |
| 发布 | 选择账号 → 选择命名空间（用户、组织、群组）→ 可见性 |
| PR / MR、CI、分支规则 | 绑定账号的平台具备该能力时显示；术语用平台自己的叫法（Pull Request / Merge Request） |
| 菜单 | “View on <平台名>” 已实施（见仓库网页方案）；“Create Pull Request” 按平台显示 MR 等 |
| Copilot | 只在 GitHub 账号下可用，其余平台不显示入口 |
| 偏好设置 · 身份 | 身份列表；编辑作者、签名、SSH 别名（从 `~/.ssh/config` 选择）、绑定账号、匹配规则；显示匹配到的仓库数 |
| 仓库设置 · Git Config | 选项改为“使用全局配置 / 使用身份（下拉选择）/ 使用本仓库自定义配置”，选择身份后显示将写入的配置 |
| 添加类对话框 | 每个仓库显示匹配到的身份；已有配置与身份不同时列出差异并可逐项选择是否覆盖 |
| 管理仓库 | 按身份过滤；批量“套用身份”，先预览每个仓库的改动，确认后写入 |
| 仓库列表 | 身份不一致的仓库显示提示标记 |

## 数据迁移

升级首次启动时一次完成，迁移前把 `users` 与数据库版本记入日志，失败时保留旧数据不删除，下次启动重试。

1. localStorage `users` → `accounts`：每个账号 `provider = 'github'`，`userId = String(id)`。
2. 钥匙串：按旧键 `"<prefix> - <endpoint>"` 读取令牌，写入新键后再删除旧键。
3. Dexie 新版本：`owners` → `namespaces`、`gitHubRepositories` → `hostedRepositories`
   （`provider = 'github'`，`fullPath = login/name`），`repositories.accountKey` 按现有 endpoint 匹配回填。
4. `PullRequestDatabase`、`IssuesDatabase`、`GitHubUserDatabase` 中的 `gitHubRepositoryID` 改为
   `hostedRepositoryID`，数值不变。
5. `endpoint-version:*`、`selected-copilot-models-by-account`、`genericGitAuth/username/*` 键名改为
   新的账号键格式。
6. 身份为新增数据，`repositories.identity` 初始为 `automatic`；不自动写入任何仓库配置，
   由用户确认“从现有仓库推断身份”的建议后才创建身份与绑定。
7. 配置文件（`docs/plans/2026-10-10-repository-management.md`）`version` 升为 2，新增顶层
   `identities`，仓库项新增 `identity`（身份 label）；导入 `version: 1` 的文件保持现有行为。

## 实施顺序

每一步都直接写成终态代码，完成后应用可正常使用：

1. 平台接口与领域模型；GitHub 实现迁入 `hosting/github/`，各 store 改为依赖接口。
2. `AccountKey`、账号存储、钥匙串、凭据租约与数据迁移；同主机多账号。
3. 仓库绑定、远程地址解析、凭据助手按绑定选账号；仓库设置中的账号选项。
4. 界面：偏好设置账号页、登录流程选平台、克隆、发布、菜单文案、能力驱动的显示。
5. 仓库身份：身份模型与存储、规则匹配（含 SSH 别名解析）、写入仓库配置与差异确认、
   身份检查与提示、偏好设置身份页、仓库设置与添加类对话框、管理仓库批量套用、配置文件 v2。
   身份可不绑定账号，本步骤不依赖 GitLab 等平台实现。
6. GitLab 实现（含 MR、流水线状态）。
7. Gitea / Forgejo 实现。
8. Bitbucket Cloud 实现。

## 验证

- 单元测试：各平台远程地址解析（含子组、SSH 别名）、账号绑定规则、凭据助手选账号、
  数据迁移（旧 `users`、旧钥匙串键、Dexie 旧版本 → 新版本，迁移失败重试不丢数据）、
  各平台 API 响应到领域模型的转换；身份规则匹配（别名解析、最长命名空间前缀、手动指定优先）、
  写入仓库配置的差异计算、远程地址改写校验、配置文件 v1 / v2 导入。
- 手动：同时登录两个 GitHub.com 账号与一个 GitLab 账号，分别克隆、推送、查看 PR / MR 与 CI 状态；
  为 `maxwellyu1024` 别名建身份后添加仓库，在终端执行 `git config --local -l` 与提交，作者与远程地址正确；
  升级现有数据后账号、仓库、PR 列表完整。
- 类型检查、ESLint、Prettier 通过。
