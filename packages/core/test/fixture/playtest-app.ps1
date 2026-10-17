# A tiny "game" for the playtest tool: the background shows the last input it received.
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$form = New-Object System.Windows.Forms.Form
$form.Text = 'Playtest Fixture'
$form.ClientSize = New-Object System.Drawing.Size 400, 300
$form.BackColor = [System.Drawing.Color]::FromArgb(0, 0, 255)
$form.KeyPreview = $true
$form.Add_MouseDown({
  param($sender, $event)
  $form.BackColor = if ($event.X -lt 200) { [System.Drawing.Color]::FromArgb(255, 0, 0) } else { [System.Drawing.Color]::FromArgb(0, 255, 0) }
  [Console]::WriteLine("click $($event.X) $($event.Y)")
})
$form.Add_KeyDown({
  param($sender, $event)
  if ($event.KeyCode -eq 'Space') { $form.BackColor = [System.Drawing.Color]::FromArgb(255, 255, 0) }
  [Console]::WriteLine("key $($event.KeyCode)")
})
$form.Add_KeyPress({ param($sender, $event) [Console]::WriteLine("char $($event.KeyChar)") })
[System.Windows.Forms.Application]::Run($form)
