# 远程地址的 SSH 主机别名解析

## 问题

远程地址使用 `~/.ssh/config` 中定义的主机别名（如 `git@maxwellyu1024:owner/repo.git`，`Host maxwellyu1024` → `HostName github.com`）时，Desktop 把别名本身当作主机名，与账号 endpoint 的主机名（`github.com`）直接比较，结果：

- `matchGitHubRepository` 匹配失败，`repository.gitHubRepository` 为 null，“View on GitHub”、PR、Issue 等 GitHub 功能全部不可用。
- `findAccountForRemoteURL` 无法按主机名选中账号。
- `urlMatchesRemote` / `urlsMatch` / `repositoryMatchesRemote` 在 fork 上游识别、PR 匹配、remote URL 更新中均把别名与真实主机判定为不同主机。

## 目标

所有基于远程地址主机名的判断，对 SSH 远程一律使用 SSH 实际连接时生效的主机名。别名仓库与直接写 `github.com` 的仓库行为完全一致，残留差异为 0。远程的原始 URL 保持不变，git 传输照常使用别名对应的密钥。

## 设计

### 1. `app/src/lib/ssh/ssh-host-alias.ts`

- `SSHHostAliasResolver`：
  - `resolve(hosts)`（异步）：对未缓存的主机执行 `ssh -G -- <host>`，读取输出中的 `hostname` 行写入缓存。与 git 连接时使用同一套解析规则（`Include`、`Match`、通配 `Host` 均生效），不自行解析配置文件。
  - `getHostname(host)`（同步）：返回缓存的真实主机名；未缓存时返回原值。
  - 同一主机的并发解析合并为一次。解析失败、超时（5 秒）或 `ssh` 不可用时，`getHostname` 返回原值；
    只记录失败时间，60 秒内不重复启动 `ssh`，之后再次解析，偶发失败（如启动时 `ssh` 超时）不会影响整个会话。
    失败原因以 warn 级别写入日志。
  - 拒绝以 `-` 开头的主机名，参数通过数组传递，不经过 shell。
- 导出单例 `sshHostAliasResolver`；SSH 配置是用户级全局配置，单例缓存与其作用域一致。

### 2. `app/src/lib/remote-parsing.ts`

- 原正则解析逻辑保留为内部 `parseRemoteURL`（只做字符串解析）。
- `parseRemote` 对 `protocol === 'ssh'` 的结果，用 `sshHostAliasResolver.getHostname` 替换 `hostname`。所有经由 `parseRemote` / `parseRepositoryIdentifier` 的调用方（repository-matching、find-account、app-store、clone、submodule diff）自动获得真实主机名。
- 新增 `resolveRemoteHostAliases(urls)`：从 URL 中取出 SSH 主机并调用 `sshHostAliasResolver.resolve`。

### 3. 预热缓存

在读取远程地址的入口调用 `resolveRemoteHostAliases`，保证同步解析发生前缓存已就绪：

- `getRemotes`（`app/src/lib/git/remote.ts`）：GitStore、app-store 等所有远程读取都经过这里。
- `findAccountForRemoteURL`（`app/src/lib/find-account.ts`）：clone 等直接使用用户输入 URL 的流程。

### 4. 测试

- `SSHHostAliasResolver`：解析成功、解析失败回退原值、失败 60 秒后重试、并发去重、拒绝 `-` 开头的主机。
- `parseRemote`：缓存命中后 SSH URL 返回真实主机名；HTTPS URL 不受影响。
- `matchGitHubRepository`：别名 SSH 远程匹配 github.com 账号。

## 验收

- 别名远程的仓库 “View on GitHub” 可用，并打开 `https://github.com/<owner>/<repo>`。
- `tsc --noEmit` 无新增错误；新增与相关已有测试通过；Prettier / ESLint 通过。
