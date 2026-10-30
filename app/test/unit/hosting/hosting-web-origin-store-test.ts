import assert from 'node:assert'
import { describe, it, mock } from 'node:test'

import {
  HostingWebOriginStore,
  IHostingWebOriginEntry,
} from '../../../src/lib/hosting/hosting-web-origin-store'
import { IHostingWebOrigin } from '../../../src/lib/hosting/hosting-platform'

const forgejo: IHostingWebOrigin = {
  origin: 'http://192.168.124.11:3000',
  platform: 'forgejo',
}

function createStore(
  detected: IHostingWebOrigin | null = forgejo,
  initial: unknown = []
) {
  const storage = {
    value: initial,
    read: () => storage.value,
    write: (entries: ReadonlyArray<IHostingWebOriginEntry>) => {
      storage.value = entries
    },
  }
  const detect = mock.fn(async (_candidates: ReadonlyArray<string>) => detected)
  const clock = { now: 0 }
  const store = new HostingWebOriginStore(detect, storage, () => clock.now)
  return { store, detect, storage, clock }
}

describe('HostingWebOriginStore', () => {
  it('loads valid stored entries and skips invalid ones', () => {
    const { store } = createStore(null, [
      {
        host: 'Git.Example.com',
        origin: 'https://git.example.com/ignored/path',
        platform: 'gitlab',
        source: 'user',
      },
      { host: 'a', origin: 'ftp://a', platform: null, source: 'user' },
      { host: 'b', origin: 'https://b', platform: 'svn', source: 'user' },
      'garbage',
    ])

    assert.deepEqual(store.getAll(), [
      {
        host: 'git.example.com',
        origin: 'https://git.example.com',
        platform: 'gitlab',
        source: 'user',
      },
    ])
  })

  it('stores detected web origins', async () => {
    const { store, detect, storage } = createStore()
    const onDidUpdate = mock.fn()
    store.onDidUpdate(onDidUpdate)

    await store.resolve('192.168.124.11', ['http://192.168.124.11:3000'])

    assert.equal(detect.mock.callCount(), 1)
    assert.deepEqual(store.get('192.168.124.11'), {
      host: '192.168.124.11',
      ...forgejo,
      source: 'detected',
    })
    assert.deepEqual(storage.value, store.getAll())
    assert.equal(onDidUpdate.mock.callCount(), 1)
  })

  it('shares concurrent detections of a host', async () => {
    const { store, detect } = createStore()

    await Promise.all([
      store.resolve('192.168.124.11', ['http://192.168.124.11:3000']),
      store.resolve('192.168.124.11', ['http://192.168.124.11:3000']),
    ])

    assert.equal(detect.mock.callCount(), 1)
  })

  it('detects failed hosts again only after the retry interval', async () => {
    const { store, detect, clock } = createStore(null)
    const candidates = ['https://git.example.com']

    await store.resolve('git.example.com', candidates)
    clock.now = 59 * 1000
    await store.resolve('git.example.com', candidates)

    assert.equal(detect.mock.callCount(), 1)
    assert.equal(store.hasFailed('git.example.com'), true)
    assert.equal(store.get('git.example.com'), undefined)

    clock.now = 60 * 1000
    assert.equal(store.hasFailed('git.example.com'), false)
    await store.resolve('git.example.com', candidates)

    assert.equal(detect.mock.callCount(), 2)
  })

  it('stores hosts detected after failing', async () => {
    const { store, detect, clock } = createStore(null)
    const candidates = ['http://192.168.124.11:3000']

    await store.resolve('192.168.124.11', candidates)
    detect.mock.mockImplementation(async () => forgejo)
    clock.now = 60 * 1000
    await store.resolve('192.168.124.11', candidates)

    assert.equal(store.get('192.168.124.11')?.origin, forgejo.origin)
    assert.equal(store.hasFailed('192.168.124.11'), false)
  })

  it('does not detect public hosting services', async () => {
    const { store, detect } = createStore()

    await store.resolve('github.com', ['https://github.com'])

    assert.equal(detect.mock.callCount(), 0)
  })

  it('keeps entries set by the user while detecting', async () => {
    const { store } = createStore()

    const resolving = store.resolve('192.168.124.11', [forgejo.origin])
    store.setUserEntry('192.168.124.11', 'https://git.internal', 'gitea')
    await resolving

    assert.deepEqual(store.get('192.168.124.11'), {
      host: '192.168.124.11',
      origin: 'https://git.internal',
      platform: 'gitea',
      source: 'user',
    })
  })

  it('rejects web origins that are not http(s)', () => {
    const { store } = createStore()

    assert.throws(() => store.setUserEntry('host', 'git@host:a/b', null))
  })

  it('replaces entries when detecting again succeeds', async () => {
    const { store } = createStore()

    store.setUserEntry('192.168.124.11', 'https://git.internal', null)

    assert.equal(await store.redetect('192.168.124.11', [forgejo.origin]), true)
    assert.equal(store.get('192.168.124.11')?.source, 'detected')
  })

  it('keeps entries when detecting again fails', async () => {
    const { store } = createStore(null)

    store.setUserEntry('192.168.124.11', 'https://git.internal', null)

    assert.equal(
      await store.redetect('192.168.124.11', [forgejo.origin]),
      false
    )
    assert.equal(store.get('192.168.124.11')?.origin, 'https://git.internal')
  })
})
