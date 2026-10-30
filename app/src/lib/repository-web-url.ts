import { IRemote } from '../models/remote'
import { Repository, getGitHubHtmlUrl } from '../models/repository'
import {
  HostingPlatform,
  IHostingWebOrigin,
  getKnownHostingWebOrigin,
} from './hosting/hosting-platform'
import { getSSHHostWebOriginCandidates } from './hosting/hosting-web-origin-store'
import { hostingWebOriginStore } from './hosting/hosting-web-origins'
import { sshHostAliasResolver } from './ssh/ssh-host-alias'

/** The web page of a repository and the platform serving it */
export interface IRepositoryWebPage {
  readonly url: string
  /** The platform serving the page, or null if it isn't known */
  readonly platform: HostingPlatform | null
}

interface IRemoteWebLocation {
  /** The host as written in the remote URL */
  readonly host: string
  /** Whether the host is reached over SSH, and so may be an SSH host alias */
  readonly isSSH: boolean
  /** The origin of http(s) remotes, which also serve the web pages */
  readonly origin: string | null
  /** The repository path, e.g. `group/subgroup/name`, without `.git` */
  readonly path: string
}

const schemeRegex = /^[a-z][a-z0-9+.-]*:\/\//i
// scp 写法：[user@]host:path
const scpLikeRegex = /^(?:[^@/]+@)?([^:/]+):(.+)$/

function parseRemoteWebLocation(url: string): IRemoteWebLocation | null {
  const trimmed = url.trim()
  let host: string
  let path: string
  let isSSH: boolean
  let origin: string | null = null

  if (schemeRegex.test(trimmed)) {
    let parsed: URL
    try {
      parsed = new URL(trimmed)
    } catch {
      return null
    }

    switch (parsed.protocol) {
      case 'http:':
      case 'https:':
        isSSH = false
        origin = parsed.origin
        break
      case 'ssh:':
      case 'git+ssh:':
      case 'ssh+git:':
        isSSH = true
        break
      case 'git:':
        isSSH = false
        break
      default:
        return null
    }

    host = parsed.hostname
    path = parsed.pathname
  } else {
    const match = scpLikeRegex.exec(trimmed)
    // 单个字母是 Windows 盘符（C:/repo），不是主机
    if (match === null || match[1].length < 2) {
      return null
    }

    host = match[1]
    path = match[2]
    isSSH = true
  }

  const segments = path
    .replace(/\/+$/, '')
    .replace(/\.git$/, '')
    .split('/')
    .filter(segment => segment.length > 0)

  if (host.length === 0 || segments.length < 2 || segments[0] === '~') {
    return null
  }

  return { host, isSSH, origin, path: segments.join('/') }
}

/** The real hostname of a remote, resolving SSH host aliases */
function getRealHost(location: IRemoteWebLocation) {
  return (
    location.isSSH
      ? sshHostAliasResolver.getHostname(location.host)
      : location.host
  ).toLowerCase()
}

function getWebOrigin(location: IRemoteWebLocation): IHostingWebOrigin | null {
  const host = getRealHost(location)
  const entry = hostingWebOriginStore.get(host)

  if (entry !== undefined) {
    return { origin: entry.origin, platform: entry.platform }
  }

  return (
    getKnownHostingWebOrigin(host) ??
    (location.origin !== null
      ? { origin: location.origin, platform: null }
      : null)
  )
}

/**
 * Get the web page of the repository a remote URL points to, or null if its
 * web origin isn't known.
 *
 * This is synchronous, using SSH host aliases and web origins that have
 * already been resolved; see `resolveRemoteWebPage`. It works without a
 * signed in account.
 */
export function getRemoteWebPage(url: string): IRepositoryWebPage | null {
  const location = parseRemoteWebLocation(url)
  const webOrigin = location !== null ? getWebOrigin(location) : null

  return location !== null && webOrigin !== null
    ? {
        url: `${webOrigin.origin}/${location.path}`,
        platform: webOrigin.platform,
      }
    : null
}

/**
 * Resolve the SSH host alias and detect the web origin of a remote's host if
 * they aren't known yet, then get the web page of the repository.
 */
export async function resolveRemoteWebPage(
  url: string
): Promise<IRepositoryWebPage | null> {
  const location = parseRemoteWebLocation(url)
  if (location === null) {
    return null
  }

  if (location.isSSH) {
    await sshHostAliasResolver.resolve([location.host])
  }

  const host = getRealHost(location)
  await hostingWebOriginStore.resolve(
    host,
    location.origin !== null
      ? [location.origin]
      : getSSHHostWebOriginCandidates(host)
  )

  return getRemoteWebPage(url)
}

/**
 * Get the web page of a repository: the associated GitHub repository when
 * there is one, otherwise the page its remote points to.
 */
export function getRepositoryWebPage(
  repository: Repository,
  remote: IRemote | null
): IRepositoryWebPage | null {
  const gitHubURL = getGitHubHtmlUrl(repository)
  if (gitHubURL !== null) {
    return { url: gitHubURL, platform: 'github' }
  }

  return remote !== null ? getRemoteWebPage(remote.url) : null
}
