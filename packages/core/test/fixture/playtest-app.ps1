# A tiny "game" for the playtest tool: an intro to skip, a menu with a Play label, then a level
# whose background shows the last input it received. -Decoy adds a bigger black "Loader" window
# shown off-screen, like the helper windows NW.js and Chromium keep beside the real one.
param([switch]$Decoy)
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$form = New-Object System.Windows.Forms.Form
$form.Text = 'Playtest Fixture'
$form.ClientSize = New-Object System.Drawing.Size 400, 300
$form.BackColor = [System.Drawing.Color]::FromArgb(128, 0, 128)
$form.KeyPreview = $true
$script:state = 'intro'
$font = New-Object System.Drawing.Font 'Segoe UI', 18, ([System.Drawing.FontStyle]::Bold)
function New-Text([string]$text, [int]$x, [int]$y) {
  $label = New-Object System.Windows.Forms.Label
  $label.Text = $text
  $label.Font = $font
  $label.AutoSize = $true
  $label.ForeColor = [System.Drawing.Color]::White
  $label.BackColor = [System.Drawing.Color]::Black
  $label.Location = New-Object System.Drawing.Point $x, $y
  $form.Controls.Add($label)
  $label
}
[void](New-Text 'STUDIO LOGO' 110 20)
function Show-Menu {
  $script:state = 'menu'
  $form.Controls.Clear()
  $form.BackColor = [System.Drawing.Color]::FromArgb(40, 40, 40)
  [void](New-Text 'Main Menu' 130 40)
  $play = New-Text 'Play' 170 200
  $play.Add_MouseDown({ Show-Level })
  [Console]::WriteLine('menu')
}
function Show-Level {
  $script:state = 'level'
  $form.Controls.Clear()
  $form.BackColor = [System.Drawing.Color]::FromArgb(0, 0, 255)
  [void](New-Text 'Level 1' 10 10)
  [Console]::WriteLine('level')
}
$form.Add_MouseDown({
  param($sender, $event)
  if ($script:state -eq 'intro') { Show-Menu; return }
  if ($script:state -ne 'level') { return }
  $form.BackColor = if ($event.X -lt 200) { [System.Drawing.Color]::FromArgb(255, 0, 0) } else { [System.Drawing.Color]::FromArgb(0, 255, 0) }
  [Console]::WriteLine("click $($event.X) $($event.Y)")
})
$form.Add_KeyDown({
  param($sender, $event)
  if ($script:state -eq 'intro') { Show-Menu; return }
  if ($script:state -eq 'level' -and $event.KeyCode -eq 'Space') { $form.BackColor = [System.Drawing.Color]::FromArgb(255, 255, 0) }
  [Console]::WriteLine("key $($event.KeyCode)")
})
$form.Add_KeyPress({ param($sender, $event) [Console]::WriteLine("char $($event.KeyChar)") })
if ($Decoy) {
  $loader = New-Object System.Windows.Forms.Form
  $loader.Text = 'Loader'
  $loader.ClientSize = New-Object System.Drawing.Size 600, 450
  $loader.BackColor = [System.Drawing.Color]::Black
  $loader.StartPosition = 'Manual'
  $loader.Location = New-Object System.Drawing.Point -6000, -6000
  # Shown from the message loop, after the main window took the launch's first (hidden) show.
  $timer = New-Object System.Windows.Forms.Timer
  $timer.Interval = 50
  $timer.Add_Tick({ $timer.Stop(); $loader.Show() })
  $timer.Start()
}
[System.Windows.Forms.Application]::Run($form)
