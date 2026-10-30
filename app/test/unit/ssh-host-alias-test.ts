import assert from 'node:assert'
import { before, describe, it, mock } from 'node:test'

import { SSHHostAliasResolver } from '../../src/lib/ssh/ssh-host-alias'
import { Account } from '../../src/models/account'

/** Stand-in for `ssh -G`, mapping aliases as `~/.ssh/config` would */
const sshConfig = new Map([
  ['work', 'github.com'],
  ['personal', 'github.com'],
])
const readHostname = mock.fn(
  async (host: string) => sshConfig.get(host) ?? host
)

let parseRemote: typeof import('../../src/lib/remote-parsing').parseRemote
let resolveRemoteHostAliases: typeof import('../../src/lib/remote-parsing').resolveRemoteHostAliases
let matchGitHubRepository: typeof import('../../src/lib/repository-matching').matchGitHubRepository
let urlMatchesRemote: typeof import('../../src/lib/repository-matching').urlMatchesRemote

before(async () => {
  mock.module('../../src/lib/ssh/ssh-host-alias.ts', {
    namedExports: {
      SSHHostAliasResolver,
      sshHostAliasResolver: new SSHHostAliasResolver(readHostname),
    },
  })
  ;({ parseRemote, resolveRemoteHostAliases } = await import(
    '../../src/lib/remote-parsing'
  ))
  ;({ matchGitHubRepository, urlMatchesRemote } = await import(
    '../../src/lib/repository-matching'
  ))
})

function createDotComAccount() {
  return new Account(
    'alovelace',
    'https://api.github.com',
    '',
    [],
    '',
    1,
    '',
    'free'
  )
}

describe('SSHHostAliasResolver', () => {
  it('returns the effective hostname once resolved', async () => {
    const resolver = new SSHHostAliasResolver(async () => 'github.com')

    assert.equal(resolver.getHostname('work'), 'work')
    await resolver.resolve(['work'])
    assert.equal(resolver.getHostname('work'), 'github.com')
  })

  it('falls back to the host when resolution fails', async () => {
    const resolver = new SSHHostAliasResolver(async () => {
      throw new Error('ssh not found')
    })

    await resolver.resolve(['work'])
    assert.equal(resolver.getHostname('work'), 'work')
  })

  it('falls back to the host when ssh reports no hostname', async () => {
    const resolver = new SSHHostAliasResolver(async () => null)

    await resolver.resolve(['work'])
    assert.equal(resolver.getHostname('work'), 'work')
  })

  it('resolves failed hosts again only after the retry interval', async () => {
    const reader = mock.fn(async (_host: string): Promise<string | null> => {
      throw new Error('ssh timed out')
    })
    const clock = { now: 0 }
    const resolver = new SSHHostAliasResolver(reader, () => clock.now)

    await resolver.resolve(['work'])
    clock.now = 59 * 1000
    await resolver.resolve(['work'])
    assert.equal(reader.mock.callCount(), 1)

    reader.mock.mockImplementation(async () => 'github.com')
    clock.now = 60 * 1000
    await resolver.resolve(['work'])

    assert.equal(reader.mock.callCount(), 2)
    assert.equal(resolver.getHostname('work'), 'github.com')
  })

  it('resolves each host only once', async () => {
    const reader = mock.fn(async (_host: string) => 'github.com')
    const resolver = new SSHHostAliasResolver(reader)

    await Promise.all([
      resolver.resolve(['work', 'work']),
      resolver.resolve(['work']),
    ])
    await resolver.resolve(['work'])

    assert.equal(reader.mock.callCount(), 1)
  })

  it('never passes hosts that look like options to ssh', async () => {
    const reader = mock.fn(async (_host: string) => 'github.com')
    const resolver = new SSHHostAliasResolver(reader)

    await resolver.resolve(['-oProxyCommand=evil'])

    assert.equal(reader.mock.callCount(), 0)
    assert.equal(
      resolver.getHostname('-oProxyCommand=evil'),
      '-oProxyCommand=evil'
    )
  })
})

describe('remote URLs using SSH host aliases', () => {
  const aliasUrl = 'git@work:octocat/Hello-World.git'

  before(async () => {
    await resolveRemoteHostAliases([
      aliasUrl,
      'ssh://git@personal/octocat/Hello-World.git',
      'https://work/octocat/Hello-World.git',
    ])
  })

  it('parses SSH remotes with the real hostname', () => {
    assert.equal(parseRemote(aliasUrl)?.hostname, 'github.com')
    assert.equal(
      parseRemote('ssh://git@personal/octocat/Hello-World.git')?.hostname,
      'github.com'
    )
  })

  it('leaves HTTPS remotes untouched', () => {
    assert.equal(
      parseRemote('https://work/octocat/Hello-World.git')?.hostname,
      'work'
    )
  })

  it('matches an aliased remote to a GitHub.com account', () => {
    const match = matchGitHubRepository([createDotComAccount()], aliasUrl)

    assert(match !== null)
    assert.equal(match.owner, 'octocat')
    assert.equal(match.name, 'Hello-World')
  })

  it('matches an aliased remote against the GitHub clone URL', () => {
    assert.equal(
      urlMatchesRemote('https://github.com/octocat/Hello-World.git', {
        name: 'origin',
        url: aliasUrl,
      }),
      true
    )
  })
})
