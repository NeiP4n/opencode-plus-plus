# Removes Opencode++ installed by opencode-pp-install.ps1. In PowerShell:
#
#   irm https://raw.githubusercontent.com/NeiP4n/opencode-plus-plus/lan-rooms/opencode-pp-uninstall.ps1 | iex
#
# Removes %LOCALAPPDATA%\opencode-pp (sources and the `opencode-pp` command) and its PATH
# entry. Sessions, settings and credentials in ~\.config\opencode and ~\.local\share\opencode
# are shared with a regular opencode, so they stay unless $env:OPENCODE_PP_PURGE = "1" is set
# first. Git and Bun stay too: other programs may use them.
# `irm | iex` runs in the caller's session, so the body runs in a child scope like the installer.
& {
$ErrorActionPreference = "Stop"

$Dir = if ($env:OPENCODE_PP_DIR) { $env:OPENCODE_PP_DIR } else { Join-Path $env:LOCALAPPDATA "opencode-pp" }
$Bin = Join-Path $Dir "bin"
$Removed = $false

# rmdir does not follow the junctions Bun and the installer put in node_modules, so nothing
# outside the folder is touched; Windows PowerShell's Remove-Item -Recurse can trip over them.
function Remove-Folder($Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return $false }
  cmd /c rmdir /s /q "`"$Path`""
  if (Test-Path -LiteralPath $Path) {
    throw "Could not remove $Path. Close every opencode-pp window and run this again."
  }
  Write-Host "Removed $Path"
  return $true
}

$Wrapper = Join-Path $Bin "opencode-pp.cmd"
if ((Test-Path -LiteralPath $Dir) -and -not (Test-Path -LiteralPath (Join-Path $Dir "src\.git")) -and -not (Test-Path -LiteralPath $Wrapper)) {
  Write-Warning "Skipped ${Dir}: not an Opencode++ install."
} elseif (Remove-Folder $Dir) {
  $Removed = $true
}

$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
$UserPathEntries = @($UserPath -split ";" | Where-Object { $_ })
if ($UserPathEntries -contains $Bin) {
  [Environment]::SetEnvironmentVariable("Path", (@($UserPathEntries | Where-Object { $_ -ne $Bin }) -join ";"), "User")
  Write-Host "Removed $Bin from your user PATH."
  $Removed = $true
}
$env:Path = (@($env:Path -split ";" | Where-Object { $_ -and $_ -ne $Bin }) -join ";")

$Purge = $env:OPENCODE_PP_PURGE -eq "1"
if ($Purge) {
  # The same folders a regular opencode uses: purging removes its sessions and settings too.
  foreach ($Path in @(".local\share\opencode", ".config\opencode", ".local\state\opencode", ".cache\opencode")) {
    if (Remove-Folder (Join-Path $env:USERPROFILE $Path)) { $Removed = $true }
  }
}

Write-Host ""
if ($Removed) { Write-Host "Opencode++ is uninstalled." } else { Write-Host "Opencode++ was not found in $Dir." }
if (-not $Purge) {
  Write-Host "Sessions and settings in ~\.config\opencode and ~\.local\share\opencode are kept (shared with opencode)."
  Write-Host 'To remove them too, run $env:OPENCODE_PP_PURGE = "1" first, then the same command.'
}
}
