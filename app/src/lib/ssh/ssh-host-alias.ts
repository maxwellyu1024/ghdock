import { execFile } from 'child_process'

/** How long to wait for `ssh -G` before giving up on a host, in milliseconds */
const ResolveTimeout = 5000

/** How long to wait before retrying a failed host, in milliseconds */
const RetryInterval = 60 * 1000

/**
 * Reads the effective hostname for the given SSH host, or null if it can't be
 * determined.
 */
export type SSHHostnameReader = (host: string) => Promise<string | null>

/**
 * Read the effective hostname for an SSH host using `ssh -G`, which evaluates
 * the user's SSH configuration (including `Include`, `Match` and wildcard
 * `Host` blocks) exactly as it would when Git connects, without connecting.
 */
export function readSSHHostname(host: string): Promise<string | null> {
  return new Promise(resolve => {
    execFile(
      'ssh',
      ['-G', '--', host],
      { timeout: ResolveTimeout, windowsHide: true },
      (error, stdout) => {
        if (error) {
          log.warn(`Unable to resolve SSH host '${host}'`, error)
          resolve(null)
          return
        }

        const match = /^hostname (.+)$/m.exec(stdout)
        if (match === null) {
          log.warn(`ssh -G reported no hostname for SSH host '${host}'`)
        }
        resolve(match !== null ? match[1].trim() : null)
      }
    )
  })
}

/**
 * Resolves SSH host aliases (e.g. `Host work` → `HostName github.com` in
 * `~/.ssh/config`) to the hostname SSH actually connects to, so remote URLs
 * using an alias can be matched against GitHub endpoints.
 *
 * Resolution is asynchronous and cached; lookups are synchronous and return
 * the host unchanged until it has been resolved. A failed resolution is
 * retried once `RetryInterval` has passed, so a transient failure (e.g. `ssh`
 * timing out while the app starts) doesn't hide the alias for the session.
 */
export class SSHHostAliasResolver {
  private readonly hostnames = new Map<string, string>()
  private readonly pending = new Map<string, Promise<void>>()
  /** When resolution of each host last failed */
  private readonly failedAt = new Map<string, number>()

  public constructor(
    private readonly readHostname: SSHHostnameReader = readSSHHostname,
    private readonly now: () => number = Date.now
  ) {}

  /** Resolve and cache the effective hostname of each of the given hosts. */
  public async resolve(hosts: ReadonlyArray<string>): Promise<void> {
    await Promise.all([...new Set(hosts)].map(host => this.resolveHost(host)))
  }

  /**
   * Get the effective hostname for a host, or the host itself if it hasn't
   * been resolved.
   */
  public getHostname(host: string): string {
    return this.hostnames.get(host) ?? host
  }

  private resolveHost(host: string): Promise<void> {
    const failedAt = this.failedAt.get(host)
    if (
      this.hostnames.has(host) ||
      (failedAt !== undefined && this.now() - failedAt < RetryInterval)
    ) {
      return Promise.resolve()
    }

    const existing = this.pending.get(host)
    if (existing !== undefined) {
      return existing
    }

    const promise = this.readHostnameSafely(host).then(hostname => {
      this.pending.delete(host)
      // 失败只记录时间：间隔内不重复启动 ssh 进程，过后再试，避免一次偶发失败影响整个会话
      if (hostname === null) {
        this.failedAt.set(host, this.now())
      } else {
        this.failedAt.delete(host)
        this.hostnames.set(host, hostname)
      }
    })
    this.pending.set(host, promise)
    return promise
  }

  private async readHostnameSafely(host: string): Promise<string | null> {
    // 以 - 开头的主机名会被 ssh 当作选项解析，不交给 ssh，按原样作为主机名
    if (host.length === 0 || host.startsWith('-')) {
      return host
    }

    try {
      const hostname = await this.readHostname(host)
      return hostname !== null && hostname.length > 0 ? hostname : null
    } catch (e) {
      log.warn(`Unable to resolve SSH host '${host}'`, e)
      return null
    }
  }
}

/** The resolver shared by all remote URL parsing in the app */
export const sshHostAliasResolver = new SSHHostAliasResolver()
