import { Repository } from '../../models/repository'
import { IMenuItem } from '../../lib/menu-item'
import { IRepositoryIdentityState } from '../../lib/identity/repository-identity'
import { IIdentity, RepositoryIdentityBinding } from '../../models/identity'
import { buildIdentityMenuItems } from '../identities/identity-menu'
import { Repositoryish, movePinnedRepository } from './group-repositories'
import { Shell } from '../../lib/shells'
import { writeClipboardText } from '../main-process-proxy'
import { IRepositoryWebPage } from '../../lib/repository-web-url'
import { getHostingPlatformName } from '../../lib/hosting/hosting-platform'
import {
  RevealInFileManagerLabel,
  DefaultEditorLabel,
  DefaultShellLabel,
} from '../lib/context-menu'

interface IRepositoryListItemContextMenuConfig {
  repository: Repositoryish
  shellLabel: string | undefined
  externalEditorLabel: string | undefined
  /** The configured editor, marked in the editor submenu; null if custom */
  selectedExternalEditor: string | null
  /** All editors installed on the user's machine */
  availableExternalEditors: ReadonlyArray<string>
  /** The configured shell, marked in the shell submenu; null if custom */
  selectedShell: Shell | null
  /** All shells installed on the user's machine */
  availableShells: ReadonlyArray<Shell>
  askForConfirmationOnRemoveRepository: boolean
  /** The web page of the repository; null if its web origin isn't known */
  webPage: IRepositoryWebPage | null
  onViewOnGitHub: (url: string) => void
  onOpenInShell: (repository: Repositoryish) => void
  onShowRepository: (repository: Repositoryish) => void
  onOpenInExternalEditor: (repository: Repositoryish) => void
  onOpenInSelectedShell: (repository: Repository, shell: Shell) => void
  onOpenInSelectedExternalEditor: (
    repository: Repository,
    editor: string
  ) => void
  onRemoveRepository: (repository: Repositoryish) => void
  onChangeRepositoryAlias: (repository: Repository) => void
  onRemoveRepositoryAlias: (repository: Repository) => void
  onTogglePinRepository: (repository: Repository) => void
  /** All pinned repositories, in the order of the pinned group */
  pinnedRepositories: ReadonlyArray<Repository>
  /** Called with all pinned repositories in their new order */
  onReorderPinnedRepositories: (repositories: ReadonlyArray<Repository>) => void
  onCreateWorktree?: (repository: Repository) => void
  onShowWorktrees?: (repository: Repository) => void
  /** The identities to choose from */
  identities: ReadonlyArray<IIdentity>
  /** Which identity each repository uses and whether its config matches */
  repositoryIdentityStates: ReadonlyMap<number, IRepositoryIdentityState>
  onSwitchRepositoryIdentity: (
    repository: Repository,
    binding: RepositoryIdentityBinding
  ) => void
  onApplyRepositoryIdentity: (repository: Repository) => void
}

export const generateRepositoryListContextMenu = (
  config: IRepositoryListItemContextMenuConfig
) => {
  const { repository, webPage } = config
  const missing = repository instanceof Repository && repository.missing
  const openInExternalEditor = config.externalEditorLabel
    ? `Open in ${config.externalEditorLabel}`
    : DefaultEditorLabel
  const openInShell = config.shellLabel
    ? `Open in ${config.shellLabel}`
    : DefaultShellLabel

  const items: ReadonlyArray<IMenuItem> = [
    ...buildPinMenuItems(config),
    ...buildAliasMenuItems(config),
    ...buildIdentitySubmenuItems(config),
    ...buildWorktreeMenuItems(config),
    {
      label: __DARWIN__ ? 'Copy Repo Name' : 'Copy repo name',
      action: () => writeClipboardText(repository.name),
    },
    {
      label: __DARWIN__ ? 'Copy Repo Path' : 'Copy repo path',
      action: () => writeClipboardText(repository.path),
    },
    { type: 'separator' },
    {
      label: `View on ${getHostingPlatformName(webPage?.platform ?? null)}`,
      action: () => {
        if (webPage !== null) {
          config.onViewOnGitHub(webPage.url)
        }
      },
      enabled: webPage !== null,
    },
    {
      label: openInShell,
      action: () => config.onOpenInShell(repository),
      enabled: !missing,
    },
    ...buildShellSubmenuItems(config),
    {
      label: RevealInFileManagerLabel,
      action: () => config.onShowRepository(repository),
      enabled: !missing,
    },
    {
      label: openInExternalEditor,
      action: () => config.onOpenInExternalEditor(repository),
      enabled: !missing,
    },
    ...buildEditorSubmenuItems(config),
    { type: 'separator' },
    {
      label: config.askForConfirmationOnRemoveRepository ? 'Remove…' : 'Remove',
      action: () => config.onRemoveRepository(repository),
    },
  ]

  return items
}

const buildAliasMenuItems = (
  config: IRepositoryListItemContextMenuConfig
): ReadonlyArray<IMenuItem> => {
  const { repository } = config

  if (!(repository instanceof Repository)) {
    return []
  }

  const verb = repository.alias == null ? 'Create' : 'Change'
  const items: Array<IMenuItem> = [
    {
      label: __DARWIN__ ? `${verb} Alias` : `${verb} alias`,
      action: () => config.onChangeRepositoryAlias(repository),
    },
  ]

  if (repository.alias !== null) {
    items.push({
      label: __DARWIN__ ? 'Remove Alias' : 'Remove alias',
      action: () => config.onRemoveRepositoryAlias(repository),
    })
  }

  return items
}

const buildIdentitySubmenuItems = (
  config: IRepositoryListItemContextMenuConfig
): ReadonlyArray<IMenuItem> => {
  const { repository, identities } = config

  if (
    !(repository instanceof Repository) ||
    identities.length === 0 ||
    repository.missing
  ) {
    return []
  }

  return [
    {
      label: 'Identity',
      submenu: buildIdentityMenuItems({
        repositories: [repository],
        identities,
        states: config.repositoryIdentityStates,
        onSwitch: binding =>
          config.onSwitchRepositoryIdentity(repository, binding),
        onApply: () => config.onApplyRepositoryIdentity(repository),
      }),
    },
  ]
}

const buildWorktreeMenuItems = (
  config: IRepositoryListItemContextMenuConfig
): ReadonlyArray<IMenuItem> => {
  const { repository, onCreateWorktree, onShowWorktrees } = config

  if (!(repository instanceof Repository)) {
    return []
  }

  if (onCreateWorktree === undefined && onShowWorktrees === undefined) {
    return []
  }

  const items: Array<IMenuItem> = []

  if (onShowWorktrees !== undefined) {
    items.push({
      label: __DARWIN__ ? 'Show Worktrees' : 'Show worktrees',
      action: () => onShowWorktrees(repository),
    })
  }

  if (onCreateWorktree !== undefined) {
    items.push({
      label: __DARWIN__ ? 'New Worktree…' : 'New worktree…',
      action: () => onCreateWorktree(repository),
    })
  }

  return items
}

const buildPinMenuItems = (
  config: IRepositoryListItemContextMenuConfig
): ReadonlyArray<IMenuItem> => {
  const { repository } = config

  if (!(repository instanceof Repository)) {
    return []
  }

  const label = repository.isPinned
    ? __DARWIN__
      ? 'Unpin Repository'
      : 'Unpin repository'
    : __DARWIN__
    ? 'Pin Repository'
    : 'Pin repository'

  return [
    {
      label,
      action: () => config.onTogglePinRepository(repository),
    },
    ...buildMovePinnedSubmenuItems(config, repository),
  ]
}

/**
 * Builds a submenu moving a pinned repository within the pinned group, the
 * keyboard accessible alternative to reordering it by dragging.
 */
const buildMovePinnedSubmenuItems = (
  config: IRepositoryListItemContextMenuConfig,
  repository: Repository
): ReadonlyArray<IMenuItem> => {
  const { pinnedRepositories } = config
  const index = pinnedRepositories.findIndex(r => r.id === repository.id)

  if (index === -1 || pinnedRepositories.length < 2) {
    return []
  }

  // 插入点语义与拖拽一致：下移一位需要插入到下一项之后
  const moves: ReadonlyArray<[string, string, number]> = [
    ['Move to Top', 'Move to top', 0],
    ['Move Up', 'Move up', index - 1],
    ['Move Down', 'Move down', index + 2],
    ['Move to Bottom', 'Move to bottom', pinnedRepositories.length],
  ]

  return [
    {
      label: __DARWIN__ ? 'Move Pinned Repository' : 'Move pinned repository',
      submenu: moves.map(([darwinLabel, label, insertionIndex]) => {
        const order = movePinnedRepository(
          pinnedRepositories,
          repository,
          insertionIndex
        )
        return {
          label: __DARWIN__ ? darwinLabel : label,
          enabled: order !== null,
          action: () => {
            if (order !== null) {
              config.onReorderPinnedRepositories(order)
            }
          },
        }
      }),
    },
  ]
}

/**
 * Builds a submenu offering every installed shell. Only shown when there is
 * more than one to choose from, since the configured shell already has its own
 * menu item.
 */
const buildShellSubmenuItems = (
  config: IRepositoryListItemContextMenuConfig
): ReadonlyArray<IMenuItem> => {
  const { repository, availableShells, selectedShell } = config

  if (!(repository instanceof Repository) || availableShells.length < 2) {
    return []
  }

  return [
    {
      label: __DARWIN__ ? 'Open With Terminal' : 'Open with terminal',
      enabled: !repository.missing,
      submenu: availableShells.map(shell => ({
        label: shell,
        type: 'checkbox' as const,
        checked: shell === selectedShell,
        action: () => config.onOpenInSelectedShell(repository, shell),
      })),
    },
  ]
}

/**
 * Builds a submenu offering every installed editor. Only shown when there is
 * more than one to choose from, since the configured editor already has its
 * own menu item.
 */
const buildEditorSubmenuItems = (
  config: IRepositoryListItemContextMenuConfig
): ReadonlyArray<IMenuItem> => {
  const { repository, availableExternalEditors, selectedExternalEditor } =
    config

  if (
    !(repository instanceof Repository) ||
    availableExternalEditors.length < 2
  ) {
    return []
  }

  return [
    {
      label: __DARWIN__ ? 'Open With Editor' : 'Open with editor',
      enabled: !repository.missing,
      submenu: availableExternalEditors.map(editor => ({
        label: editor,
        type: 'checkbox' as const,
        checked: editor === selectedExternalEditor,
        action: () => config.onOpenInSelectedExternalEditor(repository, editor),
      })),
    },
  ]
}
