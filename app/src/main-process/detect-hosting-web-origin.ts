import {
  HostingPlatform,
  IHostingWebOrigin,
  parseWebOrigin,
} from '../lib/hosting/hosting-platform'

/** How long to wait for each probe request, in milliseconds */
const ProbeTimeout = 3000

export type ProbeFetch = (
  url: string,
  init: { readonly signal: AbortSignal }
) => Promise<Response>

/** Fetch a URL, returning null on network errors and timeouts */
async function tryFetch(
  fetch: ProbeFetch,
  url: string
): Promise<Response | null> {
  try {
    return await fetch(url, { signal: AbortSignal.timeout(ProbeTimeout) })
  } catch (e) {
    log.debug(`Hosting probe of ${url} failed`, e)
    return null
  }
}

async function readJSON(response: Response | null): Promise<unknown> {
  if (response === null || !response.ok) {
    return null
  }

  try {
    return await response.json()
  } catch {
    return null
  }
}

function readStringField(json: unknown, field: string): string | null {
  if (typeof json !== 'object' || json === null) {
    return null
  }

  const value = (json as Record<string, unknown>)[field]
  return typeof value === 'string' ? value : null
}

/** Gitea and Forgejo serve `/api/v1/version`; Forgejo's version says so */
async function probeGitea(
  fetch: ProbeFetch,
  origin: string
): Promise<HostingPlatform | null> {
  const [gitea, forgejo] = await Promise.all([
    tryFetch(fetch, `${origin}/api/v1/version`).then(readJSON),
    tryFetch(fetch, `${origin}/api/forgejo/v1/version`).then(readJSON),
  ])

  if (readStringField(forgejo, 'version') !== null) {
    return 'forgejo'
  }

  const version = readStringField(gitea, 'version')
  if (version === null) {
    return null
  }

  // Forgejo 报告兼容的 Gitea 版本，如 "15.0.3+gitea-1.22.0"
  return version.includes('+gitea-') ? 'forgejo' : 'gitea'
}

/** GitLab requires authentication for `/api/v4/version` but identifies itself */
async function probeGitLab(
  fetch: ProbeFetch,
  origin: string
): Promise<HostingPlatform | null> {
  const response = await tryFetch(fetch, `${origin}/api/v4/version`)
  if (response === null) {
    return null
  }

  if (response.headers.has('x-gitlab-meta')) {
    return 'gitlab'
  }

  if (response.status === 401) {
    const body = await response.text().catch(() => '')
    return body.includes('"401 Unauthorized"') ? 'gitlab' : null
  }

  const json = await readJSON(response)
  return readStringField(json, 'version') !== null &&
    readStringField(json, 'revision') !== null
    ? 'gitlab'
    : null
}

/** GitHub Enterprise Server reports its version from `/api/v3/meta` */
async function probeGitHub(
  fetch: ProbeFetch,
  origin: string
): Promise<HostingPlatform | null> {
  const json = await readJSON(await tryFetch(fetch, `${origin}/api/v3/meta`))
  return readStringField(json, 'installed_version') !== null ? 'github' : null
}

async function probePlatform(
  fetch: ProbeFetch,
  origin: string
): Promise<HostingPlatform | null> {
  const platforms = await Promise.all([
    probeGitea(fetch, origin),
    probeGitLab(fetch, origin),
    probeGitHub(fetch, origin),
  ])

  return platforms.find(p => p !== null) ?? null
}

/**
 * Find the web origin of a code hosting server among the candidate origins,
 * in order, identifying the platform from its API. When no candidate is a
 * recognized platform, the first one serving a page is used with an unknown
 * platform.
 */
export async function detectHostingWebOrigin(
  candidates: ReadonlyArray<string>,
  fetch: ProbeFetch
): Promise<IHostingWebOrigin | null> {
  const origins = candidates
    .map(parseWebOrigin)
    .filter((origin): origin is string => origin !== null)

  // 平台接口与根路径同时请求，不可达主机最多等待一个超时
  const [platforms, servesPages] = await Promise.all([
    Promise.all(origins.map(origin => probePlatform(fetch, origin))),
    Promise.all(
      origins.map(origin =>
        tryFetch(fetch, `${origin}/`).then(r => r !== null && r.ok)
      )
    ),
  ])

  const index = platforms.findIndex(p => p !== null)
  if (index !== -1) {
    return { origin: origins[index], platform: platforms[index] }
  }

  const fallback = servesPages.indexOf(true)
  return fallback !== -1 ? { origin: origins[fallback], platform: null } : null
}
