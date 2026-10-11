/* eslint-disable no-sync */

import * as cp from 'child_process'
import * as path from 'path'
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs'
import { getCompanyName, getProductName, getVersion } from '../app/package-info'
import {
  getChannel,
  getDistArchitecture,
  getDistPath,
  getDistRoot,
  getExecutableName,
} from './dist-info'

/** Electron 应用在 Ubuntu 22.04 / 24.04 上的运行依赖（24.04 的 t64 包提供旧包名） */
const dependencies = [
  'libgtk-3-0 | libgtk-3-0t64',
  'libnotify4',
  'libnss3',
  'libxss1',
  'libxtst6',
  'libatspi2.0-0 | libatspi2.0-0t64',
  'libuuid1',
  'libsecret-1-0',
  'libgbm1',
  'libasound2 | libasound2t64',
  'xdg-utils',
]

/** 与 build.ts 中注册的 OAuth 回调协议保持一致 */
function getAuthProtocolScheme() {
  return getChannel() === 'development' ||
    !process.env.DESKTOP_OAUTH_CLIENT_SECRET
    ? 'x-github-desktop-dev-auth'
    : 'x-github-desktop-auth'
}

/** Debian 版本号中预发布后缀需用 `~` 才会排在正式版之前 */
function getDebianVersion() {
  return getVersion().replace(/-/g, '~')
}

function getDebianArchitecture() {
  return getDistArchitecture() === 'x64' ? 'amd64' : 'arm64'
}

/** Build a .deb package from the packaged app in the dist directory. */
export function packageLinux() {
  const name = getExecutableName()
  const productName = getProductName()
  const installDir = `/opt/${name}`
  const stage = path.join(getDistRoot(), 'deb')
  const dest = path.join(
    getDistRoot(),
    `${name}_${getDebianVersion()}_${getDebianArchitecture()}.deb`
  )

  rmSync(stage, { recursive: true, force: true })
  rmSync(dest, { force: true })

  console.log('Staging Debian package…')
  const appDir = path.join(stage, installDir)
  mkdirSync(path.dirname(appDir), { recursive: true })
  cpSync(getDistPath(), appDir, { recursive: true, verbatimSymlinks: true })
  // Electron 解压出的应用根目录权限为 0700，cpSync 会原样保留，
  // 安装后普通用户将无法进入 /opt/<name>
  chmodSync(appDir, 0o755)

  // Ubuntu 24.04 限制了非特权用户命名空间，Chromium 需要 SUID 沙箱
  const sandbox = path.join(appDir, 'chrome-sandbox')
  if (existsSync(sandbox)) {
    chmodSync(sandbox, 0o4755)
  }

  const binDir = path.join(stage, 'usr', 'bin')
  mkdirSync(binDir, { recursive: true })
  symlinkSync(`${installDir}/${name}`, path.join(binDir, name))

  const iconDir = path.join(stage, 'usr/share/icons/hicolor/512x512/apps')
  mkdirSync(iconDir, { recursive: true })
  cpSync(
    path.join(__dirname, '..', 'app', 'static', 'linux', 'icon-logo.png'),
    path.join(iconDir, `${name}.png`)
  )

  const applicationsDir = path.join(stage, 'usr', 'share', 'applications')
  mkdirSync(applicationsDir, { recursive: true })
  writeFileSync(
    path.join(applicationsDir, `${name}.desktop`),
    [
      '[Desktop Entry]',
      'Type=Application',
      `Name=${productName}`,
      'Comment=Simple collaboration from your desktop',
      `Exec=${installDir}/${name} %U`,
      `Icon=${name}`,
      'Terminal=false',
      'Categories=Development;RevisionControl;',
      `MimeType=x-scheme-handler/${getAuthProtocolScheme()};`,
      `StartupWMClass=${productName}`,
      '',
    ].join('\n')
  )

  const installedSize = cp
    .execSync(`du -sk "${stage}"`, { encoding: 'utf8' })
    .split('\t')[0]

  const debianDir = path.join(stage, 'DEBIAN')
  mkdirSync(debianDir, { recursive: true })
  writeFileSync(
    path.join(debianDir, 'control'),
    [
      `Package: ${name}`,
      `Version: ${getDebianVersion()}`,
      `Architecture: ${getDebianArchitecture()}`,
      `Maintainer: ${getCompanyName()}`,
      `Installed-Size: ${installedSize}`,
      `Depends: ${dependencies.join(', ')}`,
      'Section: devel',
      'Priority: optional',
      `Description: ${productName}`,
      ' Simple collaboration from your desktop.',
      '',
    ].join('\n')
  )

  console.log('Packaging for Linux…')
  cp.execSync(`dpkg-deb --root-owner-group --build "${stage}" "${dest}"`, {
    stdio: 'inherit',
  })
  rmSync(stage, { recursive: true, force: true })
  console.log(`Debian package created at ${dest}`)
}
