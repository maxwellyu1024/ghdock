import { Disposable, Emitter } from 'event-kit'
import {
  IHostingWebOrigin,
  getKnownHostingWebOrigin,
  isHostingPlatform,
  parseWebOrigin,
} from './hosting-platform'

/** Where a host's web origin came from */
export type HostingWebOriginSource = 'detected' | 'user'

export interface IHostingWebOriginEntry extends IHostingWebOrigin {
  /** The real hostname, after resolving SSH host aliases */
  readonly host: string
  readonly source: HostingWebOriginSource
}

/** Finds the web origin of a host among candidate origins, or null */
export type HostingWebOriginDetector = (
  candidates: ReadonlyArray<string>
) => Promise<IHostingWebOrigin | null>

/** Persists the entries; localStorage in the app, in memory in tests */
export interface IHostingWebOriginStorage {
  read(): unknown
  write(entries: ReadonlyArray<IHostingWebOriginEntry>): void
}

const StorageKey = 'hosting-web-origins'

export const localHostingWebOriginStorage: IHostingWebOriginStorage = {
  read: () => {
    const raw = localStorage.getItem(StorageKey)
    if (raw === null) {
      return []
    }

    try {
      return JSON.parse(raw)
    } catch (e) {
      log.error(`Could not parse ${StorageKey}`, e)
      return []
    }
  },
  write: entries => localStorage.setItem(StorageKey, JSON.stringify(entries)),
}

function normalizeHost(host: string) {
  return host.trim().toLowerCase()
}

function parseEntry(value: unknown): IHostingWebOriginEntry | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const { host, origin, platform, source } = value as Record<string, unknown>
  if (typeof host !== 'string' || typeof origin !== 'string') {
    return null
  }

  const parsedOrigin = parseWebOrigin(origin)
  if (
    host.length === 0 ||
    parsedOrigin === null ||
    (platform !== null && !isHostingPlatform(platform)) ||
    (source !== 'detected' && source !== 'user')
  ) {
    return null
  }

  return { host: normalizeHost(host), origin: parsedOrigin, platform, source }
}

/**
 * The web origins of code hosting servers, by host. SSH remotes say nothing
 * about the scheme and port of a server's web pages, so they are detected on
 * first use or set by the user, and remembered.
 */
export class HostingWebOriginStore {
  private readonly emitter = new Emitter()
  private readonly entries = new Map<string, IHostingWebOriginEntry>()
  /** Hosts whose detection failed in this session, to avoid probing again */
  private readonly failed = new Set<string>()
  private readonly pending = new Map<string, Promise<void>>()

  public constructor(
    private readonly detect: HostingWebOriginDetector,
    private readonly storage: IHostingWebOriginStorage = localHostingWebOriginStorage
  ) {
    const stored = storage.read()
    for (const value of Array.isArray(stored) ? stored : []) {
      const entry = parseEntry(value)
      if (entry !== null) {
        this.entries.set(entry.host, entry)
      }
    }
  }

  /** Get the entry for a host, if it has been detected or set */
  public get(host: string): IHostingWebOriginEntry | undefined {
    return this.entries.get(normalizeHost(host))
  }

  /** All entries, sorted by host */
  public getAll(): ReadonlyArray<IHostingWebOriginEntry> {
    return [...this.entries.values()].sort((a, b) =>
      a.host.localeCompare(b.host)
    )
  }

  /** Set the web origin of a host, replacing any detected entry */
  public setUserEntry(
    host: string,
    origin: string,
    platform: IHostingWebOriginEntry['platform']
  ) {
    const entry = parseEntry({ host, origin, platform, source: 'user' })
    if (entry === null) {
      throw new Error(`Invalid web origin '${origin}' for host '${host}'`)
    }

    this.entries.set(entry.host, entry)
    this.save()
  }

  /** Forget the web origin of a host */
  public remove(host: string) {
    const normalized = normalizeHost(host)
    this.failed.delete(normalized)
    if (this.entries.delete(normalized)) {
      this.save()
    }
  }

  /**
   * Detect the web origin of a host among the candidate origins unless it is
   * already known, is a public hosting service, or failed to be detected in
   * this session. Concurrent requests for a host share one detection.
   */
  public resolve(host: string, candidates: ReadonlyArray<string>) {
    const normalized = normalizeHost(host)
    if (
      this.entries.has(normalized) ||
      this.failed.has(normalized) ||
      getKnownHostingWebOrigin(normalized) !== null ||
      candidates.length === 0
    ) {
      return Promise.resolve()
    }

    const existing = this.pending.get(normalized)
    if (existing !== undefined) {
      return existing
    }

    const promise = this.detectSafely(candidates).then(detected => {
      this.pending.delete(normalized)

      // 探测期间用户可能已手动填写，不能被探测结果覆盖
      if (this.entries.has(normalized)) {
        return
      }

      if (detected === null) {
        this.failed.add(normalized)
        this.emitter.emit('did-update')
        return
      }

      this.entries.set(normalized, {
        host: normalized,
        ...detected,
        source: 'detected',
      })
      this.save()
    })

    this.pending.set(normalized, promise)
    return promise
  }

  /**
   * Detect a host again, replacing its entry only when detection succeeds.
   * Returns whether it succeeded.
   */
  public async redetect(
    host: string,
    candidates: ReadonlyArray<string>
  ): Promise<boolean> {
    const normalized = normalizeHost(host)
    const detected = await this.detectSafely(candidates)
    if (detected === null) {
      return false
    }

    this.failed.delete(normalized)
    this.entries.set(normalized, {
      host: normalized,
      ...detected,
      source: 'detected',
    })
    this.save()
    return true
  }

  /** Whether detection of the host failed in this session */
  public hasFailed(host: string) {
    return this.failed.has(normalizeHost(host))
  }

  public onDidUpdate(fn: () => void): Disposable {
    return this.emitter.on('did-update', fn)
  }

  private async detectSafely(candidates: ReadonlyArray<string>) {
    try {
      return await this.detect(candidates)
    } catch (e) {
      log.error(`Could not detect the web origin of ${candidates[0]}`, e)
      return null
    }
  }

  private save() {
    this.storage.write(this.getAll())
    this.emitter.emit('did-update')
  }
}

/** Candidate web origins for a server reached over SSH, in probing order */
export function getSSHHostWebOriginCandidates(
  host: string
): ReadonlyArray<string> {
  // Gitea / Forgejo 默认在 3000 端口提供网页
  return [`https://${host}`, `http://${host}`, `http://${host}:3000`]
}
