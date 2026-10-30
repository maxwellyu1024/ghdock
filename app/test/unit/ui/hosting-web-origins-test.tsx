import assert from 'node:assert'
import { describe, it } from 'node:test'
import * as React from 'react'

import { HostingWebOriginStore } from '../../../src/lib/hosting/hosting-web-origin-store'
import { HostingWebOrigins } from '../../../src/ui/preferences/hosting-web-origins'
import { fireEvent, render, screen } from '../../helpers/ui/render'

function createStore() {
  let stored: unknown = []
  return new HostingWebOriginStore(async () => null, {
    read: () => stored,
    write: entries => (stored = entries),
  })
}

function getTextBox(label: string) {
  return screen.getByLabelText(label) as HTMLInputElement
}

describe('HostingWebOrigins', () => {
  it('lists entries with their platform and source', () => {
    const store = createStore()
    store.setUserEntry(
      '192.168.124.11',
      'http://192.168.124.11:3000',
      'forgejo'
    )

    render(<HostingWebOrigins store={store} />)

    assert.notEqual(screen.queryByText('192.168.124.11'), null)
    assert.notEqual(
      screen.queryByText('http://192.168.124.11:3000 · Forgejo · Custom'),
      null
    )
  })

  it('adds an entry', () => {
    const store = createStore()
    render(<HostingWebOrigins store={store} />)

    const add = screen.getByRole('button', { name: 'Add' })
    assert.equal(add.getAttribute('aria-disabled'), 'true')

    fireEvent.change(getTextBox('Host'), {
      target: { value: 'git.example.com' },
    })
    fireEvent.change(getTextBox('Web address'), {
      target: { value: 'https://git.example.com/' },
    })
    fireEvent.change(screen.getByLabelText('Platform'), {
      target: { value: 'gitlab' },
    })
    fireEvent.click(add)

    assert.deepEqual(store.get('git.example.com'), {
      host: 'git.example.com',
      origin: 'https://git.example.com',
      platform: 'gitlab',
      source: 'user',
    })
    assert.notEqual(screen.queryByText('git.example.com'), null)
  })

  it('removes an entry', () => {
    const store = createStore()
    store.setUserEntry('git.example.com', 'https://git.example.com', null)
    render(<HostingWebOrigins store={store} />)

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))

    assert.equal(store.get('git.example.com'), undefined)
    assert.equal(screen.queryByText('git.example.com'), null)
  })
})
