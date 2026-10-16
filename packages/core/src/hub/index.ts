export * as Hub from "./index.js"

export type { Backend, Category, Entry, Platform } from "./types.js"
export { placeholders, slotKey, optionalSlot } from "./types.js"
export { all, categories, get } from "./catalog/index.js"
export {
  available,
  choose,
  chooseBackend,
  machine,
  missingTools,
  portable,
  prepare,
  render,
  supportsPlatform,
  type Choice,
  type Machine,
  type Rendered,
  MissingArgumentError,
  MissingToolError,
  NoBackendError,
} from "./resolve.js"
export { InvalidArgumentError, quote } from "./quote.js"
export { HubHost } from "./host.js"
export {
  planFor,
  removeCommand,
  detectManager,
  installable,
  manualInstall,
  type Elevation,
  type Manager,
  type Plan,
} from "./install.js"
export { read, setTerminal, type State } from "./state.js"
export * as HubActions from "./actions.js"
export type { ActionResult } from "./actions.js"
export { renderHubHints, type Hints } from "./prompt.js"
export { hinted, discoverable } from "./visibility.js"
export { rewrite } from "./match.js"
