import * as React from 'react'
import { Disposable } from 'event-kit'
import { Row } from '../lib/row'
import { TextBox } from '../lib/text-box'
import { Select } from '../lib/select'
import { Button } from '../lib/button'
import {
  HostingWebOriginStore,
  IHostingWebOriginEntry,
  getSSHHostWebOriginCandidates,
} from '../../lib/hosting/hosting-web-origin-store'
import {
  HostingPlatform,
  getHostingPlatformName,
  hostingPlatforms,
  isHostingPlatform,
  parseWebOrigin,
} from '../../lib/hosting/hosting-platform'

const UnknownPlatform = 'unknown'

interface IHostingWebOriginsProps {
  readonly store: HostingWebOriginStore
}

interface IHostingWebOriginsState {
  readonly entries: ReadonlyArray<IHostingWebOriginEntry>
  /** The host whose entry is being edited, or null when adding one */
  readonly editingHost: string | null
  readonly host: string
  readonly origin: string
  readonly platform: HostingPlatform | null
  readonly detectingHost: string | null
  readonly message: string | null
}

const emptyForm = {
  editingHost: null,
  host: '',
  origin: '',
  platform: null,
  message: null,
}

interface IHostingWebOriginRowProps {
  readonly entry: IHostingWebOriginEntry
  readonly detecting: boolean
  readonly onEdit: (entry: IHostingWebOriginEntry) => void
  readonly onDetect: (entry: IHostingWebOriginEntry) => void
  readonly onRemove: (entry: IHostingWebOriginEntry) => void
}

class HostingWebOriginRow extends React.Component<IHostingWebOriginRowProps> {
  private onEdit = () => this.props.onEdit(this.props.entry)
  private onDetect = () => this.props.onDetect(this.props.entry)
  private onRemove = () => this.props.onRemove(this.props.entry)

  public render() {
    const { entry, detecting } = this.props

    return (
      <li className="hosting-web-origin-row">
        <div className="hosting-web-origin-details">
          <div className="hosting-web-origin-host">{entry.host}</div>
          <div className="hosting-web-origin-detail">
            {entry.origin} · {getHostingPlatformName(entry.platform)} ·{' '}
            {entry.source === 'user' ? 'Custom' : 'Detected'}
          </div>
        </div>
        <div className="hosting-web-origin-actions">
          <Button size="small" onClick={this.onEdit}>
            Edit
          </Button>
          <Button size="small" onClick={this.onDetect} disabled={detecting}>
            {detecting ? 'Detecting…' : 'Detect Again'}
          </Button>
          <Button size="small" onClick={this.onRemove}>
            Remove
          </Button>
        </div>
      </li>
    )
  }
}

/**
 * The web origins of self-hosted code hosting servers, used to open the web
 * pages of repositories whose remotes don't say where they are served.
 */
export class HostingWebOrigins extends React.Component<
  IHostingWebOriginsProps,
  IHostingWebOriginsState
> {
  private subscription: Disposable | null = null

  public constructor(props: IHostingWebOriginsProps) {
    super(props)
    this.state = {
      entries: props.store.getAll(),
      detectingHost: null,
      ...emptyForm,
    }
  }

  public componentDidMount() {
    this.subscription = this.props.store.onDidUpdate(() =>
      this.setState({ entries: this.props.store.getAll() })
    )
  }

  public componentWillUnmount() {
    this.subscription?.dispose()
    this.subscription = null
  }

  private onHostChanged = (host: string) => this.setState({ host })

  private onOriginChanged = (origin: string) => this.setState({ origin })

  private onPlatformChanged = (event: React.FormEvent<HTMLSelectElement>) => {
    const { value } = event.currentTarget
    this.setState({ platform: isHostingPlatform(value) ? value : null })
  }

  private onEdit = (entry: IHostingWebOriginEntry) =>
    this.setState({
      editingHost: entry.host,
      host: entry.host,
      origin: entry.origin,
      platform: entry.platform,
      message: null,
    })

  private onCancel = () => this.setState(emptyForm)

  private onRemove = (entry: IHostingWebOriginEntry) => {
    this.props.store.remove(entry.host)
    if (this.state.editingHost === entry.host) {
      this.setState(emptyForm)
    }
  }

  private onDetect = async (entry: IHostingWebOriginEntry) => {
    const { store } = this.props
    const candidates = [
      ...new Set([entry.origin, ...getSSHHostWebOriginCandidates(entry.host)]),
    ]

    this.setState({ detectingHost: entry.host, message: null })
    const detected = await store.redetect(entry.host, candidates)

    this.setState({
      detectingHost: null,
      message: detected
        ? null
        : `Could not detect the web pages of ${entry.host}; kept ${entry.origin}.`,
    })
  }

  private onSave = () => {
    const { editingHost, host, origin, platform } = this.state
    const { store } = this.props

    if (editingHost !== null && editingHost !== host.trim().toLowerCase()) {
      store.remove(editingHost)
    }

    store.setUserEntry(host, origin, platform)
    this.setState(emptyForm)
  }

  private renderForm() {
    const { editingHost, host, origin, platform } = this.state
    const canSave = host.trim().length > 0 && parseWebOrigin(origin) !== null

    return (
      <div className="hosting-web-origin-form">
        <Row>
          <TextBox
            label="Host"
            value={host}
            placeholder="git.example.com"
            onValueChanged={this.onHostChanged}
          />
          <TextBox
            label="Web address"
            value={origin}
            placeholder="https://git.example.com"
            onValueChanged={this.onOriginChanged}
          />
          <Select
            label="Platform"
            value={platform ?? UnknownPlatform}
            onChange={this.onPlatformChanged}
          >
            {hostingPlatforms.map(p => (
              <option key={p} value={p}>
                {getHostingPlatformName(p)}
              </option>
            ))}
            <option value={UnknownPlatform}>Unknown</option>
          </Select>
        </Row>
        <Row>
          <Button onClick={this.onSave} disabled={!canSave}>
            {editingHost === null ? 'Add' : 'Save'}
          </Button>
          {editingHost !== null && (
            <Button onClick={this.onCancel}>Cancel</Button>
          )}
        </Row>
      </div>
    )
  }

  public render() {
    const { entries, detectingHost, message } = this.state

    return (
      <fieldset className="hosting-web-origins">
        <legend>
          <h2>
            {__DARWIN__ ? 'Repository Web Pages' : 'Repository web pages'}
          </h2>
        </legend>
        <p className="hosting-web-origins-description">
          Where “View on …” opens repositories on self-hosted servers. Servers
          are detected the first time you view a repository on them; set the web
          address here when detection gets it wrong.
        </p>
        {entries.length > 0 && (
          <ul className="hosting-web-origin-list">
            {entries.map(entry => (
              <HostingWebOriginRow
                key={entry.host}
                entry={entry}
                detecting={detectingHost === entry.host}
                onEdit={this.onEdit}
                onDetect={this.onDetect}
                onRemove={this.onRemove}
              />
            ))}
          </ul>
        )}
        {message !== null && (
          <p className="hosting-web-origins-message" role="status">
            {message}
          </p>
        )}
        {this.renderForm()}
      </fieldset>
    )
  }
}
