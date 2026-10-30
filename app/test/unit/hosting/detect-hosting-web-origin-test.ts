import assert from 'node:assert'
import { describe, it } from 'node:test'

import {
  ProbeFetch,
  detectHostingWebOrigin,
} from '../../../src/main-process/detect-hosting-web-origin'

type Route = {
  readonly status?: number
  readonly body?: unknown
  readonly headers?: Record<string, string>
}

/** A fake network where unlisted URLs of listed origins return 404 */
function fakeFetch(routes: Record<string, Route>): ProbeFetch {
  const origins = new Set(Object.keys(routes).map(url => new URL(url).origin))

  return async url => {
    const route = routes[url]
    if (route === undefined) {
      if (!origins.has(new URL(url).origin)) {
        throw new Error('ECONNREFUSED')
      }
      return new Response('Not found', { status: 404 })
    }

    const body =
      typeof route.body === 'string'
        ? route.body
        : JSON.stringify(route.body ?? {})
    return new Response(body, {
      status: route.status ?? 200,
      headers: route.headers,
    })
  }
}

const sshCandidates = [
  'https://192.168.124.11',
  'http://192.168.124.11',
  'http://192.168.124.11:3000',
]

describe('detectHostingWebOrigin', () => {
  it('detects Forgejo from its Gitea compatible version', async () => {
    const fetch = fakeFetch({
      'http://192.168.124.11:3000/api/v1/version': {
        body: { version: '15.0.3+gitea-1.22.0' },
      },
    })

    assert.deepEqual(await detectHostingWebOrigin(sshCandidates, fetch), {
      origin: 'http://192.168.124.11:3000',
      platform: 'forgejo',
    })
  })

  it('detects Forgejo from its own API', async () => {
    const fetch = fakeFetch({
      'https://git.example.com/api/v1/version': { body: { version: '1.21' } },
      'https://git.example.com/api/forgejo/v1/version': {
        body: { version: '7.0.0' },
      },
    })

    assert.equal(
      (await detectHostingWebOrigin(['https://git.example.com'], fetch))
        ?.platform,
      'forgejo'
    )
  })

  it('detects Gitea', async () => {
    const fetch = fakeFetch({
      'https://git.example.com/api/v1/version': { body: { version: '1.22.1' } },
    })

    assert.equal(
      (await detectHostingWebOrigin(['https://git.example.com'], fetch))
        ?.platform,
      'gitea'
    )
  })

  it('detects GitLab from its unauthorized API response', async () => {
    const fetch = fakeFetch({
      'https://gitlab.example.com/api/v4/version': {
        status: 401,
        body: { message: '401 Unauthorized' },
      },
    })

    assert.equal(
      (await detectHostingWebOrigin(['https://gitlab.example.com'], fetch))
        ?.platform,
      'gitlab'
    )
  })

  it('detects GitLab from its API headers', async () => {
    const fetch = fakeFetch({
      'https://gitlab.example.com/api/v4/version': {
        status: 403,
        headers: { 'X-Gitlab-Meta': '{}' },
      },
    })

    assert.equal(
      (await detectHostingWebOrigin(['https://gitlab.example.com'], fetch))
        ?.platform,
      'gitlab'
    )
  })

  it('detects GitHub Enterprise Server', async () => {
    const fetch = fakeFetch({
      'https://ghe.example.com/api/v3/meta': {
        body: { installed_version: '3.14.0' },
      },
    })

    assert.equal(
      (await detectHostingWebOrigin(['https://ghe.example.com'], fetch))
        ?.platform,
      'github'
    )
  })

  it('prefers earlier candidates', async () => {
    const fetch = fakeFetch({
      'https://192.168.124.11/api/v1/version': { body: { version: '1.22' } },
      'http://192.168.124.11:3000/api/v1/version': {
        body: { version: '1.22' },
      },
    })

    assert.equal(
      (await detectHostingWebOrigin(sshCandidates, fetch))?.origin,
      'https://192.168.124.11'
    )
  })

  it('falls back to the first origin serving a page', async () => {
    const fetch = fakeFetch({
      'http://192.168.124.11/': { body: '<html></html>' },
    })

    assert.deepEqual(await detectHostingWebOrigin(sshCandidates, fetch), {
      origin: 'http://192.168.124.11',
      platform: null,
    })
  })

  it('returns null when no candidate responds', async () => {
    assert.equal(
      await detectHostingWebOrigin(sshCandidates, fakeFetch({})),
      null
    )
  })

  it('ignores candidates that are not http(s) origins', async () => {
    let requested = false
    const fetch: ProbeFetch = async () => {
      requested = true
      throw new Error('unexpected')
    }

    assert.equal(
      await detectHostingWebOrigin(['file:///etc', 'not a url'], fetch),
      null
    )
    assert.equal(requested, false)
  })
})
