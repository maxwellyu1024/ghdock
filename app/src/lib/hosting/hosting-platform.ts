/** Code hosting platforms whose repository pages we can open */
export type HostingPlatform =
  | 'github'
  | 'gitlab'
  | 'gitea'
  | 'forgejo'
  | 'bitbucket'
  | 'gitee'

export const hostingPlatforms: ReadonlyArray<HostingPlatform> = [
  'github',
  'gitlab',
  'gitea',
  'forgejo',
  'bitbucket',
  'gitee',
]

const platformNames: Record<HostingPlatform, string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
  gitea: 'Gitea',
  forgejo: 'Forgejo',
  bitbucket: 'Bitbucket',
  gitee: 'Gitee',
}

/**
 * Get the name of a platform for use in labels such as "View on GitHub", or
 * "Web" when the platform isn't known.
 */
export function getHostingPlatformName(
  platform: HostingPlatform | null
): string {
  return platform === null ? 'Web' : platformNames[platform]
}

export function isHostingPlatform(value: unknown): value is HostingPlatform {
  return (
    typeof value === 'string' &&
    hostingPlatforms.includes(value as HostingPlatform)
  )
}

/** Where the web pages of a host are served and which platform serves them */
export interface IHostingWebOrigin {
  /** The web origin, e.g. `http://192.168.124.11:3000`, without a path */
  readonly origin: string
  readonly platform: HostingPlatform | null
}

/** Public hosting services, whose web pages are always at `https://<host>` */
const knownHostingSites: ReadonlyMap<string, HostingPlatform> = new Map<
  string,
  HostingPlatform
>([
  ['github.com', 'github'],
  ['gitlab.com', 'gitlab'],
  ['codeberg.org', 'forgejo'],
  ['bitbucket.org', 'bitbucket'],
  ['gitee.com', 'gitee'],
])

/** Get the web origin of a public hosting service, or null for other hosts */
export function getKnownHostingWebOrigin(
  host: string
): IHostingWebOrigin | null {
  const normalized = host.toLowerCase()
  const platform = knownHostingSites.get(normalized)
  return platform === undefined
    ? null
    : { origin: `https://${normalized}`, platform }
}

/**
 * Get the normalized origin of an http(s) URL, or null if the URL isn't an
 * http(s) URL. Paths, queries and credentials are dropped.
 */
export function parseWebOrigin(url: string): string | null {
  try {
    const parsed = new URL(url.trim())
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
      ? parsed.origin
      : null
  } catch {
    return null
  }
}
