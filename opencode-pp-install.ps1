# Installs Opencode++ for Windows with one command. In PowerShell:
#
#   irm https://raw.githubusercontent.com/NeiP4n/opencode-plus-plus/lan-rooms/opencode-pp-install.ps1 | iex
#
# The installer installs Git through winget when needed, installs Bun through the official
# Bun PowerShell installer, checks out the lan-rooms branch (or the newest release tag),
# installs the CLI dependencies, and creates `opencode-pp.cmd`.
# A normal `opencode` installation is left untouched.
& {
$ErrorActionPreference = "Stop"

$Repo = if ($env:OPENCODE_PP_REPO) { $env:OPENCODE_PP_REPO } else { "https://github.com/NeiP4n/opencode-plus-plus.git" }
$Dir = if ($env:OPENCODE_PP_DIR) { $env:OPENCODE_PP_DIR } else { Join-Path $env:LOCALAPPDATA "opencode-pp" }
$Bin = Join-Path $Dir "bin"
$Branch = if ($env:OPENCODE_PP_BRANCH) { $env:OPENCODE_PP_BRANCH } else { "lan-rooms" }

function Update-SessionPath {
  $Known = @(
    [Environment]::GetEnvironmentVariable("Path", "Machine"),
    [Environment]::GetEnvironmentVariable("Path", "User"),
    "$env:USERPROFILE\.bun\bin"
  )
  $Current = @($env:Path -split ";") + $Known
  $env:Path = (@($Current | Where-Object { $_ } | Select-Object -Unique) -join ";")
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw "Git is required and winget is not available. Install Git from https://git-scm.com/download/win, then run this command again."
  }
  Write-Host "Installing Git..."
  winget install --id Git.Git -e --source winget --silent --accept-package-agreements --accept-source-agreements
  if ($LASTEXITCODE -ne 0) { throw "Git installation failed." }
  Update-SessionPath
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw "Git was installed but is not visible in this PowerShell session. Open a new PowerShell and run the installer again."
  }
}

if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
  Write-Host "Installing Bun..."
  try {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "irm https://bun.sh/install.ps1 | iex"
  } catch {
    throw "Bun installation failed: $($_.Exception.Message)"
  }
  Update-SessionPath
  if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
    throw "Bun did not become available in this PowerShell session. Open a new PowerShell and run the installer again."
  }
}

$Source = Join-Path $Dir "src"
if (Test-Path (Join-Path $Source ".git")) {
  Write-Host "Updating Opencode++..."
  git -C $Source fetch --tags --force origin
} else {
  New-Item -ItemType Directory -Force -Path $Dir | Out-Null
  Write-Host "Downloading Opencode++..."
  git clone --filter=blob:none $Repo $Source
}
if ($LASTEXITCODE -ne 0) { throw "git failed." }

$Tag = git -C $Source tag -l "release/*" --sort=-v:refname | Select-Object -First 1
if ($Tag) {
  $Target = $Tag
  $Version = $Tag -replace "^release/", ""
} else {
  Write-Host "No release is published yet; using branch $Branch."
  git -C $Source fetch --force origin "+refs/heads/${Branch}:refs/remotes/origin/${Branch}"
  if ($LASTEXITCODE -ne 0) { throw "git fetch failed." }
  $Target = "origin/$Branch"
  $Version = "$Branch (no release yet)"
}

$PreviousStash = (git -C $Source stash list --format=%H -1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0) { throw "Could not inspect the Git stash." }

# Preserve tracked edits only; untracked runtime data (.opencode/index, notes, packages/android) must stay in place.
git -C $Source stash push --message "opencode-pp installer update $(Get-Date -Format 'yyyy-MM-ddTHH:mm:ssK')"
if ($LASTEXITCODE -ne 0) { throw "Could not save local changes; no checkout was attempted." }

$CurrentStash = (git -C $Source stash list --format=%H -1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0) { throw "Could not verify the Git stash." }
$StashedLocalChanges = [bool]($CurrentStash -and $CurrentStash -ne $PreviousStash)

try {
  git -C $Source checkout --quiet --detach $Target
  if ($LASTEXITCODE -ne 0) { throw "git checkout failed." }
} finally {
  if ($StashedLocalChanges) {
    Write-Host "Restoring local changes..."
    git -C $Source stash pop
    if ($LASTEXITCODE -ne 0) {
      Write-Warning "Some local changes conflict with the updated source. The saved copy remains in Git stash."
      git -C $Source reset --hard --quiet
      Write-Host "Recover the saved work with: git -C `"$Source`" stash list"
    }
  }
}

# Ensure the tracked bootstrap source really matches the selected revision.
# Some Windows Git/Bun combinations can retain an old workspace file even after checkout.
$Preflight = Join-Path $Source "packages\cli\src\services\update-preflight.tsx"
if (Test-Path $Preflight) {
  $PreflightText = Get-Content -Raw -LiteralPath $Preflight
  if ($PreflightText -match '@opencode/tui') {
    Write-Host "Refreshing stale update-preflight.tsx..."
    git -C $Source checkout --quiet $Target -- packages/cli/src/services/update-preflight.tsx
    if ($LASTEXITCODE -ne 0) { throw "Could not refresh update-preflight.tsx." }
    $PreflightText = Get-Content -Raw -LiteralPath $Preflight
    if ($PreflightText -match '@opencode/tui') {
      throw "The selected Opencode++ revision still contains an @opencode/tui import in update-preflight.tsx."
    }
  }
}

Write-Host "Installing CLI and TUI dependencies..."
Push-Location $Source
try {
  bun install --frozen-lockfile
  if ($LASTEXITCODE -ne 0) { throw "bun install failed." }

  $TuiLink = Join-Path $Source "packages\cli\node_modules\@opencode\tui"
  $TuiPackage = Join-Path $TuiLink "package.json"
  $TuiRoot = Join-Path $Source "packages\tui"
  $TuiRootPackage = Join-Path $TuiRoot "package.json"

  if (-not (Test-Path $TuiRootPackage)) {
    throw "TUI package is missing from the checkout: $TuiRootPackage"
  }

  Write-Host "Repairing @opencode/tui workspace link..."
  $Scope = Split-Path $TuiLink -Parent
  New-Item -ItemType Directory -Force -Path $Scope | Out-Null

  # Remove a stale Bun link without following a junction into packages/tui.
  $ExistingTuiLink = Get-Item -LiteralPath $TuiLink -Force -ErrorAction SilentlyContinue
  if ($ExistingTuiLink) {
    if ($ExistingTuiLink.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
      Remove-Item -LiteralPath $TuiLink -Force -ErrorAction Stop
    } else {
      Remove-Item -LiteralPath $TuiLink -Force -Recurse -ErrorAction Stop
    }
  }

  New-Item -ItemType Junction -Path $TuiLink -Target $TuiRoot | Out-Null
  if (-not (Test-Path (Join-Path $TuiLink "package.json"))) {
    throw "Cannot link @opencode/tui. Expected $(Join-Path $TuiLink 'package.json')"
  }

  # Resolve using Bun from the CLI package. Resolve-Path on a junction reports
  # the junction path itself, not its target, and must not be used for validation.
  Push-Location (Join-Path $Source "packages\cli")
  try {
    bun -e "console.log(import.meta.resolve('@opencode/tui'))"
    if ($LASTEXITCODE -ne 0) {
      throw "Bun cannot resolve @opencode/tui from packages/cli."
    }
  } finally {
    Pop-Location
  }

  Write-Host "Verified @opencode/tui workspace resolution."
} finally {
  Pop-Location
}

New-Item -ItemType Directory -Force -Path $Bin | Out-Null
$Bun = (Get-Command bun).Source
$Cli = Join-Path $Source "packages\cli"

$Wrapper = @"
@echo off
setlocal
for /f "tokens=2 delims=:" %%c in ('chcp') do set "OPENCODE_PP_CP=%%c"
chcp 65001 >nul
set "OPENCODE_COMMAND=opencode-pp"
"$Bun" --preload="$Cli\node_modules\@opentui\solid\scripts\preload.js" "$Cli\src\index.ts" %*
set "OPENCODE_PP_EXIT=%ERRORLEVEL%"
if defined OPENCODE_PP_CP chcp %OPENCODE_PP_CP% >nul
exit /b %OPENCODE_PP_EXIT%
"@
[System.IO.File]::WriteAllText((Join-Path $Bin "opencode-pp.cmd"), $Wrapper, (New-Object System.Text.UTF8Encoding($false)))

Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $Bin "opencode.cmd")

$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
$UserPathEntries = @($UserPath -split ";" | Where-Object { $_ })
if ($UserPathEntries -notcontains $Bin) {
  [Environment]::SetEnvironmentVariable("Path", (($UserPathEntries + $Bin) -join ";"), "User")
  Write-Host "Added $Bin to your user PATH."
}

if (@($env:Path -split ";") -notcontains $Bin) { $env:Path = "$Bin;$env:Path" }

Write-Host ""
Write-Host "Opencode++ $Version is installed."
Write-Host "Run: opencode-pp"
}