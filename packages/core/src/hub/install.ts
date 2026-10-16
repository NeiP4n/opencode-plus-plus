export * as HubInstall from "./install.js"

import { HubHost } from "./host.js"

export type Manager = "apt" | "dnf" | "pacman" | "zypper" | "apk" | "brew" | "winget" | "scoop" | "choco"

// Package name per tool per manager. Absent entries fall back to the binary
// name, which is right on most managers — except winget, which needs an exact
// package id (verified with `winget show --id <id> -e`) and is skipped for any
// tool not listed here.
const PACKAGE: Record<string, Partial<Record<Manager, string>>> = {
  rg: {
    apt: "ripgrep",
    dnf: "ripgrep",
    pacman: "ripgrep",
    zypper: "ripgrep",
    apk: "ripgrep",
    brew: "ripgrep",
    winget: "BurntSushi.ripgrep.MSVC",
    scoop: "ripgrep",
    choco: "ripgrep",
  },
  fd: {
    apt: "fd-find",
    dnf: "fd-find",
    pacman: "fd",
    zypper: "fd",
    apk: "fd",
    brew: "fd",
    winget: "sharkdp.fd",
    scoop: "fd",
    choco: "fd",
  },
  jq: { winget: "jqlang.jq" },
  // The catalog uses mikefarah's yq syntax; Arch ships it as go-yq, while its `yq` is the Python wrapper.
  yq: { pacman: "go-yq", winget: "MikeFarah.yq" },
  mlr: {
    apt: "miller",
    dnf: "miller",
    pacman: "miller",
    zypper: "miller",
    apk: "miller",
    brew: "miller",
    winget: "Miller.Miller",
    scoop: "miller",
    choco: "miller",
  },
  nu: {
    apt: "nushell",
    dnf: "nushell",
    pacman: "nushell",
    apk: "nushell",
    brew: "nushell",
    winget: "Nushell.Nushell",
    choco: "nushell",
  },
  pwsh: {
    apt: "powershell",
    dnf: "powershell",
    brew: "powershell",
    winget: "Microsoft.PowerShell",
    scoop: "pwsh",
    choco: "powershell-core",
  },
  lsd: { winget: "lsd-rs.lsd" },
  sd: { winget: "chmln.sd" },
  watchexec: { winget: "watchexec.watchexec" },
  sqlite3: {
    pacman: "sqlite",
    zypper: "sqlite3",
    apk: "sqlite",
    brew: "sqlite",
    winget: "SQLite.SQLite",
    scoop: "sqlite",
    choco: "sqlite",
  },
  git: { winget: "Git.Git" },
  gh: { pacman: "github-cli", apk: "github-cli", winget: "GitHub.cli" },
  curl: { winget: "cURL.cURL" },
  tree: { winget: "GnuWin32.Tree" },
  "diff-so-fancy": { brew: "diff-so-fancy" },
  pstree: { apt: "psmisc", dnf: "psmisc", pacman: "psmisc", zypper: "psmisc", apk: "psmisc" },
  pgrep: { apt: "procps", dnf: "procps-ng", pacman: "procps-ng", zypper: "procps", apk: "procps" },
  ss: { apt: "iproute2", dnf: "iproute", pacman: "iproute2", zypper: "iproute2", apk: "iproute2" },
  dig: { apt: "dnsutils", dnf: "bind-utils", pacman: "bind", zypper: "bind-utils", apk: "bind-tools", brew: "bind" },
  nc: {
    apt: "netcat-openbsd",
    dnf: "nmap-ncat",
    pacman: "gnu-netcat",
    zypper: "netcat-openbsd",
    apk: "netcat-openbsd",
    brew: "netcat",
  },
  traceroute: { apt: "traceroute", dnf: "traceroute", pacman: "traceroute", zypper: "traceroute" },
  // semgrep is not packaged for apt or pacman; brew carries it, elsewhere it is a pip install.
  semgrep: { brew: "semgrep" },
  adb: { apt: "adb", dnf: "android-tools", pacman: "android-tools", brew: "android-platform-tools", winget: "Google.PlatformTools", scoop: "adb", choco: "adb" },
  npm: { brew: "node", winget: "OpenJS.NodeJS.LTS", scoop: "nodejs-lts", choco: "nodejs-lts", pacman: "npm", apk: "npm" },
  npx: { apt: "npm", dnf: "npm", pacman: "npm", zypper: "npm", apk: "npm", brew: "node", winget: "OpenJS.NodeJS.LTS", scoop: "nodejs-lts", choco: "nodejs-lts" },
  dotnet: { apt: "dotnet-sdk-8.0", dnf: "dotnet-sdk-8.0", pacman: "dotnet-sdk", brew: "dotnet", winget: "Microsoft.DotNet.SDK.8", scoop: "dotnet-sdk", choco: "dotnet-sdk" },
  cargo: { brew: "rust", winget: "Rustlang.Rustup", scoop: "rustup", choco: "rustup.install" },
}

// Tools that only exist on some managers' systems: Debian's package tooling
// cannot be installed through pacman or dnf, so offering it there only fails.
const ONLY: Record<string, readonly Manager[]> = {
  // Flutter, the Android emulator and Xcode come from their own installers, not package managers.
  flutter: [],
  emulator: [],
  xcrun: [],
  "apt-cache": ["apt"],
  "dpkg-query": ["apt"],
  // Semgrep is only provided by the system package managers here through Homebrew;
  // elsewhere it requires a separate pip-based installation.
  semgrep: ["brew"],
  // Arch ships PowerShell only through the AUR, which pacman cannot install.
  pwsh: ["apt", "dnf", "brew", "winget", "choco", "scoop"],
}

// What to tell the operator when the manager cannot install a tool itself.
const MANUAL: Record<string, Partial<Record<Manager, string>>> = {
  pwsh: { pacman: "from the AUR: yay -S powershell-bin" },
  flutter: { winget: "from https://docs.flutter.dev/get-started/install", scoop: "from https://docs.flutter.dev/get-started/install", choco: "from https://docs.flutter.dev/get-started/install", apt: "with snap: sudo snap install flutter --classic", brew: "with brew install --cask flutter" },
  emulator: { winget: "with Android Studio (SDK Manager → Android Emulator)", apt: "with Android Studio (SDK Manager → Android Emulator)", brew: "with Android Studio (SDK Manager → Android Emulator)" },
  xcrun: { brew: "with Xcode from the App Store" },
}

export function manualInstall(tool: string, manager: Manager | undefined) {
  return manager ? MANUAL[tool]?.[manager] : undefined
}

export function installable(tool: string, manager: Manager | undefined) {
  if (manager === undefined) return true
  const only = ONLY[tool]
  if (only) return only.includes(manager)
  return packageFor(manager, tool) !== undefined
}

const BINARY: Record<Manager, string> = {
  apt: "apt-get",
  dnf: "dnf",
  pacman: "pacman",
  zypper: "zypper",
  apk: "apk",
  brew: "brew",
  winget: "winget",
  scoop: "scoop",
  choco: "choco",
}

// Detection order mirrors what a given platform is most likely to carry;
// win32 never gets unix managers and vice versa. Linuxbrew comes last on
// Linux: it is the user-level option when the system manager needs root.
function candidates(platform: NodeJS.Platform): Manager[] {
  if (platform === "win32") return ["winget", "scoop", "choco"]
  if (platform === "darwin") return ["brew"]
  return ["apt", "dnf", "pacman", "zypper", "apk", "brew"]
}

function detected(platform: NodeJS.Platform, bin?: string): Manager[] {
  return candidates(platform).filter((manager) => HubHost.find(BINARY[manager], bin))
}

export function detectManager(platform: NodeJS.Platform = process.platform, bin?: string): Manager | undefined {
  return detected(platform, bin)[0]
}

function packageFor(manager: Manager, tool: string): string | undefined {
  const name = PACKAGE[tool]?.[manager]
  if (name) return name
  return manager === "winget" ? undefined : tool
}

// Maps tool names to the package names this manager knows them by, so install
// and remove address the same package for a given tool.
function packagesFor(manager: Manager, tools: readonly string[]): string[] {
  return Array.from(new Set(tools.map((tool) => packageFor(manager, tool)).filter((name): name is string => !!name)))
}

// How a system manager gets root. `interactive` is for a command shown to a
// person; `batch` is for one the hub runs itself with stdin closed, where sudo
// must fail fast ("a password is required") instead of waiting for input.
export type Elevation = "interactive" | "batch" | "none"

function sudo(elevation: Elevation) {
  if (elevation === "none") return ""
  return elevation === "batch" ? "sudo -n " : "sudo "
}

function installCommand(manager: Manager, packages: string[], elevation: Elevation): string {
  const joined = packages.join(" ")
  switch (manager) {
    case "apt":
      return `${sudo(elevation)}apt-get install -y ${joined}`
    case "dnf":
      return `${sudo(elevation)}dnf install -y ${joined}`
    case "pacman":
      return `${sudo(elevation)}pacman -S --needed --noconfirm ${joined}`
    case "zypper":
      return `${sudo(elevation)}zypper --non-interactive install ${joined}`
    case "apk":
      return `${sudo(elevation)}apk add ${joined}`
    case "brew":
      return `brew install ${joined}`
    case "winget":
      return packages
        .map((id) => `winget install --id ${id} -e --silent --accept-package-agreements --accept-source-agreements`)
        .join(" && ")
    case "scoop":
      return `scoop install ${joined}`
    case "choco":
      return `choco install -y ${joined}`
  }
}

// Removal counterpart of installCommand: same package mapping, manager-specific
// uninstall syntax. Mirrors installCommand's shape for easy side-by-side reading.
export function removeCommand(
  manager: Manager,
  tools: readonly string[],
  elevation: Elevation = defaultElevation(),
): string {
  const packages = packagesFor(manager, tools)
  const joined = packages.join(" ")
  switch (manager) {
    case "apt":
      return `${sudo(elevation)}apt-get remove -y ${joined}`
    case "dnf":
      return `${sudo(elevation)}dnf remove -y ${joined}`
    case "pacman":
      return `${sudo(elevation)}pacman -R --noconfirm ${joined}`
    case "zypper":
      return `${sudo(elevation)}zypper --non-interactive remove ${joined}`
    case "apk":
      return `${sudo(elevation)}apk del ${joined}`
    case "brew":
      return `brew uninstall ${joined}`
    case "winget":
      return packages.map((id) => `winget uninstall --id ${id} -e --silent --accept-source-agreements`).join(" && ")
    case "scoop":
      return `scoop uninstall ${joined}`
    case "choco":
      return `choco uninstall -y ${joined}`
  }
}

// Refreshes the package databases the way each manager allows. On pacman that
// is a full system upgrade: syncing databases without upgrading leaves a partial
// upgrade, which Arch does not support.
export function updateCommand(manager: Manager, elevation: Elevation = defaultElevation()): string | undefined {
  switch (manager) {
    case "apt":
      return `${sudo(elevation)}apt-get update`
    case "dnf":
      return `${sudo(elevation)}dnf makecache`
    case "pacman":
      return `${sudo(elevation)}pacman -Syu --noconfirm`
    case "zypper":
      return `${sudo(elevation)}zypper --non-interactive refresh`
    case "apk":
      return `${sudo(elevation)}apk update`
    case "brew":
      return "brew update"
    case "winget":
      return "winget source update"
    case "scoop":
      return "scoop update"
    case "choco":
      return undefined
  }
}

function defaultElevation(platform: NodeJS.Platform = process.platform): Elevation {
  return HubHost.privileged(platform) ? "none" : "interactive"
}

export type Plan = {
  readonly manager: Manager
  readonly command: string
  // Tools this command installs.
  readonly tools: readonly string[]
  // Tools no detected manager carries a package for; install them by hand.
  readonly unsupported: readonly string[]
}

export type PlanOptions = {
  readonly elevation?: Elevation
}

// Builds the install command for tools an entry is missing, using the first
// detected manager that covers the most of them. Returns undefined when no
// manager is detected or none of them knows any of the tools: the caller then
// falls back to plain shell.
export function planFor(
  tools: readonly string[],
  platform: NodeJS.Platform = process.platform,
  bin?: string,
  options: PlanOptions = {},
): Plan | undefined {
  if (tools.length === 0) return undefined
  let best: { manager: Manager; covered: string[] } | undefined
  for (const manager of detected(platform, bin)) {
    const covered = tools.filter((tool) => installable(tool, manager) && packageFor(manager, tool) !== undefined)
    if (!best || covered.length > best.covered.length) best = { manager, covered }
    if (covered.length === tools.length) break
  }
  if (!best || best.covered.length === 0) return undefined
  const elevation = options.elevation ?? defaultElevation(platform)
  return {
    manager: best.manager,
    command: installCommand(best.manager, packagesFor(best.manager, best.covered), elevation),
    tools: best.covered,
    unsupported: tools.filter((tool) => !best.covered.includes(tool)),
  }
}
