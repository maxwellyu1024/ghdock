import assert from 'node:assert'
import { before, beforeEach, describe, it, mock } from 'node:test'

import { SSHHostAliasResolver } from '../../src/lib/ssh/ssh-host-alias'
import {
  HostingWebOriginStore,
  IHostingWebOriginEntry,
} from '../../src/lib/hosting/hosting-web-origin-store'
import { IHostingWebOrigin } from '../../src/lib/hosting/hosting-platform'
import { Repository } from '../../src/models/repository'
import { gitHubRepoFixture } from '../helpers/github-repo-builder'

/** Stand-in for `ssh -G`, mapping aliases as `~/.ssh/config` would */
const sshConfig = new Map([
  ['work', 'github.com'],
  ['forgejo', '192.168.124.11'],
])
const sshHostAliasResolver = new SSHHostAliasResolver(
  async (host: string) => sshConfig.get(host) ?? host
)

/** Stand-in for probing servers from the main process */
const servers = new Map<string, IHostingWebOrigin>([
  [
    'http://192.168.124.11:3000',
    { origin: 'http://192.168.124.11:3000', platform: 'forgejo' },
  ],
])
const detect = mock.fn(async (candidates: ReadonlyArray<string>) => {
  const origin = candidates.find(c => servers.has(c))
  return origin !== undefined ? servers.get(origin) ?? null : null
})

let stored: ReadonlyArray<IHostingWebOriginEntry> = []
const hostingWebOriginStore = new HostingWebOriginStore(detect, {
  read: () => stored,
  write: entries => (stored = entries),
})

let webUrl: typeof import('../../src/lib/repository-web-url')

before(async () => {
  mock.module('../../src/lib/ssh/ssh-host-alias.ts', {
    namedExports: { SSHHostAliasResolver, sshHostAliasResolver },
  })
  mock.module('../../src/lib/hosting/hosting-web-origins.ts', {
    namedExports: { hostingWebOriginStore },
  })
  webUrl = await import('../../src/lib/repository-web-url')
  await sshHostAliasResolver.resolve(['work', 'forgejo'])
})

beforeEach(() => {
  for (const { host } of hostingWebOriginStore.getAll()) {
    hostingWebOriginStore.remove(host)
  }
  detect.mock.resetCalls()
})

const helloWorld = 'https://github.com/octocat/Hello-World'

describe('getRemoteWebPage', () => {
  it('returns the github.com page of HTTPS and SSH remotes', () => {
    for (const url of [
      `${helloWorld}.git`,
      'git@github.com:octocat/Hello-World.git',
      'ssh://git@github.com/octocat/Hello-World.git',
    ]) {
      assert.deepEqual(webUrl.getRemoteWebPage(url), {
        url: helloWorld,
        platform: 'github',
      })
    }
  })

  it('resolves SSH host aliases', () => {
    assert.deepEqual(
      webUrl.getRemoteWebPage('git@work:octocat/Hello-World.git'),
      { url: helloWorld, platform: 'github' }
    )
  })

  it('uses https for public hosting services', () => {
    assert.deepEqual(
      webUrl.getRemoteWebPage('git@gitlab.com:group/subgroup/project.git'),
      { url: 'https://gitlab.com/group/subgroup/project', platform: 'gitlab' }
    )
    assert.deepEqual(webUrl.getRemoteWebPage('git@codeberg.org:a/b.git'), {
      url: 'https://codeberg.org/a/b',
      platform: 'forgejo',
    })
  })

  it('uses the origin of HTTPS remotes on other hosts', () => {
    assert.deepEqual(
      webUrl.getRemoteWebPage('http://user@git.example.com:8080/team/app.git/'),
      { url: 'http://git.example.com:8080/team/app', platform: null }
    )
  })

  it('needs the web origin of SSH remotes on other hosts', () => {
    const url = 'git@forgejo:yw/ghdock.git'
    assert.equal(webUrl.getRemoteWebPage(url), null)

    hostingWebOriginStore.setUserEntry(
      '192.168.124.11',
      'http://192.168.124.11:3000',
      'forgejo'
    )

    assert.deepEqual(webUrl.getRemoteWebPage(url), {
      url: 'http://192.168.124.11:3000/yw/ghdock',
      platform: 'forgejo',
    })
  })

  it('prefers the web origin set by the user', () => {
    hostingWebOriginStore.setUserEntry(
      'gitlab.com',
      'https://mirror.example.com',
      null
    )

    assert.deepEqual(webUrl.getRemoteWebPage('git@gitlab.com:a/b.git'), {
      url: 'https://mirror.example.com/a/b',
      platform: null,
    })
  })

  it('returns null for URLs that are not repositories', () => {
    for (const url of [
      '/path/to/repository',
      'C:/path/to/repository',
      'file:///path/to/repository',
      'https://github.com/octocat',
    ]) {
      assert.equal(webUrl.getRemoteWebPage(url), null, url)
    }
  })
})

describe('resolveRemoteWebPage', () => {
  it('detects the web origin of SSH remotes once', async () => {
    const url = 'git@forgejo:yw/ghdock.git'
    const expected = {
      url: 'http://192.168.124.11:3000/yw/ghdock',
      platform: 'forgejo',
    }

    assert.deepEqual(await webUrl.resolveRemoteWebPage(url), expected)
    assert.deepEqual(await webUrl.resolveRemoteWebPage(url), expected)

    assert.equal(detect.mock.callCount(), 1)
    assert.deepEqual(detect.mock.calls[0].arguments, [
      [
        'https://192.168.124.11',
        'http://192.168.124.11',
        'http://192.168.124.11:3000',
      ],
    ])
    assert.equal(stored[0].source, 'detected')
  })

  it('probes only the origin of HTTPS remotes', async () => {
    const page = await webUrl.resolveRemoteWebPage(
      'https://git.example.com/team/app.git'
    )

    assert.deepEqual(page, {
      url: 'https://git.example.com/team/app',
      platform: null,
    })
    assert.deepEqual(detect.mock.calls[0].arguments, [
      ['https://git.example.com'],
    ])
  })

  it('does not probe public hosting services', async () => {
    await webUrl.resolveRemoteWebPage('git@github.com:octocat/Hello-World.git')
    assert.equal(detect.mock.callCount(), 0)
  })
})

describe('getRepositoryWebPage', () => {
  const remote = { name: 'origin', url: 'git@work:octocat/Hello-World.git' }

  it('uses the remote when there is no associated GitHub repository', () => {
    const repository = new Repository('/repo', 1, null, false)

    assert.deepEqual(webUrl.getRepositoryWebPage(repository, remote), {
      url: helloWorld,
      platform: 'github',
    })
    assert.equal(webUrl.getRepositoryWebPage(repository, null), null)
  })

  it('prefers the associated GitHub repository', () => {
    const repository = new Repository(
      '/repo',
      1,
      gitHubRepoFixture({ owner: 'desktop', name: 'desktop' }),
      false
    )

    assert.deepEqual(webUrl.getRepositoryWebPage(repository, remote), {
      url: 'https://github.com/desktop/desktop',
      platform: 'github',
    })
  })
})
