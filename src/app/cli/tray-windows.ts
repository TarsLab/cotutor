/**
 * Windows 托盘图标的显示脚本:Windows PowerShell + WinForms 的 NotifyIcon,系统自带,不用装东西(tray.ts 每次起来写到托盘目录再跑,存 UTF-8 带 BOM,不然中文按系统代码页读)。
 * 这里只管画和回报,不判断状态:从 stdin 收一行一条 JSON(show / notify / confirm / inspect / press / quit),从 stdout 回一行一条 JSON(ready / click / confirm / state)。
 * stdin 断了就退:看护它的 node 没了,图标也不该留着。没有桌面的会话(ssh 进来)里图标没人看得见,以 3 退,node 也不再起。
 * 深浅自己看:每两秒读一次 SystemUsesLightTheme(任务栏跟它走,不是 AppsUseLightTheme;在深色任务栏上用白色 logo,浅色用墨色)。
 * 通知走 WinRT 的 ToastNotifier + 注册的应用 ID,来源才写 cotutor;直接用 NotifyIcon 的气泡,来源是 Windows PowerShell(2026-11-06 build 26300 上都试过)。不行就退回气泡。
 * 点通知没有动作:PowerShell 5.1 接不了 WinRT 的事件(Register-ObjectEvent 报 INVALID_REGISTRATION,脚本块直接接又在别的线程上没有 runspace),所以文案同 macOS,请家长点图标。
 */
import { TRAY_AUMID } from './tray-ids.ts';

export const WINDOWS_TRAY_SCRIPT = String.raw`Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$dir = $env:COTUTOR_TRAY_DIR
$aumid = '${TRAY_AUMID}'
if ((Get-Process -Id $PID).SessionId -eq 0) { exit 3 }
$utf8 = New-Object System.Text.UTF8Encoding($false)
# stderr 进 tray.log:不设的话是系统代码页,中文 Windows 上读出来是乱码
try { [Console]::OutputEncoding = $utf8 } catch { }
$stdin = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), $utf8)
$stdout = [Console]::OpenStandardOutput()
function Emit($o) {
  $b = $utf8.GetBytes((ConvertTo-Json -Compress -InputObject $o) + [char]10)
  $stdout.Write($b, 0, $b.Length)
  $stdout.Flush()
}
$want = [System.Windows.Forms.SystemInformation]::SmallIconSize.Width
$size = (@(16, 20, 24, 32, 40, 48) | Where-Object { $_ -ge $want } | Select-Object -First 1)
if (-not $size) { $size = 48 }
$icons = @{}; $dots = @{}
foreach ($t in 'white', 'ink') { foreach ($s in 'ok', 'warn', 'bad') { $icons["$t-$s"] = [System.Drawing.Icon]::FromHandle(([System.Drawing.Bitmap]::new("$dir\icons\$t-$s-$size.png")).GetHicon()) } }
foreach ($s in 'ok', 'warn', 'bad') { $dots[$s] = [System.Drawing.Bitmap]::new("$dir\icons\dot-$s.png") }
$themeKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize'
function ThemeNow { try { if ((Get-ItemProperty $themeKey).SystemUsesLightTheme -eq 1) { 'ink' } else { 'white' } } catch { 'white' } }
$amKey = "HKCU:\Software\Classes\AppUserModelId\$aumid"
$script:toastReady = $false
$script:theme = ThemeNow
function RegisterToast {
  New-Item $amKey -Force | Out-Null
  Set-ItemProperty $amKey -Name DisplayName -Value 'cotutor'
  Set-ItemProperty $amKey -Name IconUri -Value "$dir\icons\$($script:theme)-ok-48.png"
}
try {
  RegisterToast
  [void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
  [void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]
  $script:toastReady = $true
} catch { Emit @{ type = 'error'; message = "toast: $_" } }
$ni = New-Object System.Windows.Forms.NotifyIcon
$script:level = 'ok'
$ni.Icon = $icons["$($script:theme)-ok"]; $ni.Text = 'cotutor'; $ni.Visible = $true
$menu = New-Object System.Windows.Forms.ContextMenuStrip
$menu.ShowImageMargin = $false
$menu.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 9)
$bold = New-Object System.Drawing.Font('Microsoft YaHei UI', 9, [System.Drawing.FontStyle]::Bold)
$tiny = New-Object System.Drawing.Font('Microsoft YaHei UI', 8)
$grey = [System.Drawing.Color]::FromArgb(90, 90, 90)
$ni.ContextMenuStrip = $menu
$showMenu = [System.Windows.Forms.NotifyIcon].GetMethod('ShowContextMenu', [Reflection.BindingFlags]'Instance,NonPublic')
$ni.add_MouseUp({ param($s, $e) if ($e.Button -eq 'Left') { try { $showMenu.Invoke($ni, $null) | Out-Null } catch { } } })
function Quit {
  $ni.Visible = $false
  $ni.Dispose()
  [System.Windows.Forms.Application]::Exit()
}
function Fill($entries) {
  while ($menu.Items.Count) { $x = $menu.Items[0]; $menu.Items.RemoveAt(0); $x.Dispose() }
  foreach ($e in $entries) {
    if ($e.kind -eq 'sep') { [void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)); continue }
    if ($e.kind -eq 'action') {
      $i = New-Object System.Windows.Forms.ToolStripMenuItem $e.title
      $i.Tag = $e.id
      if ($e.primary) { $i.Font = $bold }
      $i.add_Click({ param($s, $a) Emit @{ type = 'click'; id = $s.Tag } })
    } elseif ($e.kind -eq 'info') {
      $i = New-Object System.Windows.Forms.ToolStripLabel $e.title
      $i.Font = $bold
      if ($e.level) { $i.Image = $dots[$e.level]; $i.ImageAlign = 'MiddleLeft' }
      $i.TextAlign = 'MiddleLeft'
    } else {
      $i = New-Object System.Windows.Forms.ToolStripLabel $e.title
      $i.Font = $tiny
      $i.ForeColor = $grey
      $i.TextAlign = 'MiddleLeft'
    }
    [void]$menu.Items.Add($i)
  }
}
function Show($m) {
  $script:level = $m.icon
  $ni.Icon = $icons["$($script:theme)-$($m.icon)"]
  $t = [string]$m.tip
  if ($t.Length -gt 63) { $t = $t.Substring(0, 63) }
  $ni.Text = $t
  Fill $m.menu
}
function Notify($title, $body) {
  if ($script:toastReady) {
    try {
      $esc = { param($v) [System.Security.SecurityElement]::Escape([string]$v) }
      $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
      $xml.LoadXml("<toast><visual><binding template='ToastGeneric'><text>$(& $esc $title)</text><text>$(& $esc $body)</text></binding></visual></toast>")
      $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
      [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($aumid).Show($toast)
      return
    } catch { Emit @{ type = 'error'; message = "toast: $_" } }
  }
  $ni.ShowBalloonTip(8000, $title, $body, [System.Windows.Forms.ToolTipIcon]::None)
}
function Confirm($m) {
  $owner = New-Object System.Windows.Forms.Form
  $owner.TopMost = $true
  $answer = [System.Windows.Forms.MessageBox]::Show($owner, $m.body, $m.title, 'YesNo', 'Warning', 'Button2')
  $owner.Dispose()
  Emit @{ type = 'confirm'; id = $m.id; yes = ($answer -eq 'Yes') }
}
function Handle($m) {
  switch ($m.type) {
    'show' { Show $m }
    'notify' { Notify $m.title $m.body }
    'confirm' { Confirm $m }
    'quit' { Quit }
    'inspect' {
      $titles = @(); foreach ($i in $menu.Items) { $titles += [string]$i.Text }
      $p = Get-Process -Id $PID
      Emit @{ type = 'state'; icon = $script:level; theme = $script:theme; size = $size; privateMb = [int]($p.PrivateMemorySize64 / 1MB); workingMb = [int]($p.WorkingSet64 / 1MB); menu = $titles }
    }
    'press' { foreach ($i in $menu.Items) { if ($i.Tag -eq $m.id) { $i.PerformClick(); break } } }
  }
}
$script:reading = $stdin.ReadLineAsync()
$script:themeAt = Get-Date
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 200
$timer.add_Tick({
  while ($script:reading.IsCompleted) {
    $line = $script:reading.Result
    if ($null -eq $line) { $timer.Stop(); Quit; return }
    $script:reading = $stdin.ReadLineAsync()
    if ($line) { try { Handle (ConvertFrom-Json $line) } catch { Emit @{ type = 'error'; message = [string]$_ } } }
  }
  if (((Get-Date) - $script:themeAt).TotalSeconds -ge 2) {
    $script:themeAt = Get-Date
    $t = ThemeNow
    if ($t -ne $script:theme) {
      $script:theme = $t
      $ni.Icon = $icons["$t-$($script:level)"]
      if ($script:toastReady) { try { RegisterToast } catch { } }
    }
  }
})
$timer.Start()
Emit @{ type = 'ready' }
[System.Windows.Forms.Application]::Run()
`;

/** 找这台电脑上这个用户的托盘进程(命令行里带 tray run 和这个用户自己的托盘目录) */
export function findTrayScript(dir: string): string {
  return [
    `$dir = '${dir.replaceAll("'", "''")}'`,
    "$found = @(Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $c = $_.CommandLine; $c -and $c.Contains($dir) -and $c.Contains(' tray run ') })",
    'ConvertTo-Json -Compress -InputObject @($found | ForEach-Object { @{ pid = $_.ProcessId; keeper = $true } })',
  ].join('\n');
}

/** 启动器:wscript 跑它,藏着窗口起 node(和后台服务同一个办法,见 service-windows.ts) */
export function trayLauncher(commandLine: string): string {
  return `// cotutor tray on 写的;改了会被下次盖掉。关掉:cotutor tray off
new ActiveXObject("WScript.Shell").Run(${JSON.stringify(commandLine)}, 0, false);
`;
}
