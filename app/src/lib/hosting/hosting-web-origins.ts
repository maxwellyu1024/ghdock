import { detectHostingWebOrigin } from '../../ui/main-process-proxy'
import { HostingWebOriginStore } from './hosting-web-origin-store'

/** The web origins of the code hosting servers the user's remotes point to */
export const hostingWebOriginStore = new HostingWebOriginStore(
  detectHostingWebOrigin
)
