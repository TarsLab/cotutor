# cotutor 一行安装(Windows,在 PowerShell 里粘贴):
#   & ([scriptblock]::Create([Text.Encoding]::UTF8.GetString((iwr -useb https://cdn.jsdelivr.net/npm/cotutor@latest/install.ps1).Content)))
# (jsDelivr 不标编码,PowerShell 5.1 的 irm 会把中文按 Latin-1 读成乱码,所以自己按 UTF-8 解)
# 连不上 jsDelivr 就从 GitHub 取(GitHub 标了 utf-8,irm 就行):
#   irm https://raw.githubusercontent.com/TarsLab/cotutor/main/install.ps1 | iex
# 顺手建好孩子的文件夹、装好后台服务(短名 称呼 年级),最后接上就行:
#   & ([scriptblock]::Create([Text.Encoding]::UTF8.GetString((iwr -useb https://cdn.jsdelivr.net/npm/cotutor@latest/install.ps1).Content))) ming 小明 2
#
# 只做这几件事:查 Node 的版本;npm 连不上就用国内镜像;装 cotutor。
# 不要管理员,不改执行策略:npm、cotutor 都用 .cmd 跑(PowerShell 缺省策略会拦 .ps1)。Node 没装或太旧时只说怎么装,不替你装。
$ErrorActionPreference = 'Stop'

function Say($text) { Write-Host $text }
function Stop-Here($text) { Write-Host $text; throw 'cotutor-install-stopped' }

$needMajor = 22
$needMinor = 18

try {
  # ---- 1. Node ----
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Stop-Here "这台电脑还没有 Node.js:到 https://nodejs.org 下载 LTS 版(Windows 安装程序)装上,或者跑 winget install OpenJS.NodeJS.LTS;装完重开 PowerShell 再跑这一行。"
  }
  $v = (& node -p 'process.versions.node').Trim()
  $parts = $v.Split('.')
  if ([int]$parts[0] -lt $needMajor -or ([int]$parts[0] -eq $needMajor -and [int]$parts[1] -lt $needMinor)) {
    Stop-Here "Node.js 是 $v,cotutor 要 $needMajor.$needMinor 以上:到 https://nodejs.org 装新的 LTS 版,重开 PowerShell 再跑这一行。"
  }
  if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { Stop-Here '有 Node.js 但找不到 npm:到 https://nodejs.org 重新装一次 LTS 版。' }
  Say "Node.js $v"

  # ---- 2. npm 连得上吗(国内常连不上,换镜像) ----
  $registry = $null
  try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 8 'https://registry.npmjs.org/cotutor/latest' | Out-Null }
  catch { $registry = 'https://registry.npmmirror.com'; Say "npm 连不上或太慢,用国内镜像 $registry" }

  # ---- 3. 装 ----
  Say '正在下载 cotutor,要一会儿……'
  $npmArgs = @('i', '-g', 'cotutor', '--no-audit', '--no-fund')
  if ($registry) { $npmArgs += "--registry=$registry" }
  & npm.cmd @npmArgs
  if ($LASTEXITCODE -ne 0) { Stop-Here 'npm 没装成:看上面的报错;连不上就过一会儿再试。' }
  # 刚装上的 cotutor.cmd 在 npm 的全局目录里;这个窗口的 PATH 可能还没有它
  $globalDir = (& npm.cmd prefix -g).Trim()
  if (-not (Get-Command cotutor.cmd -ErrorAction SilentlyContinue)) { $env:Path = "$globalDir;$env:Path" }
  if (-not (Get-Command cotutor.cmd -ErrorAction SilentlyContinue)) { Stop-Here "装好了但找不到 cotutor:重开 PowerShell 再试;还不行,把 $globalDir 加进 PATH。" }
  Say ('cotutor ' + (& cotutor.cmd --version).Trim() + ' 装好了')

  # ---- 4. 带了孩子的信息就接着建文件夹、装后台服务 ----
  if ($args.Count -ge 1) {
    $initArgs = @('init', $args[0])
    if ($args.Count -ge 2 -and $args[1]) { $initArgs += @('--name', $args[1]) }
    if ($args.Count -ge 3 -and $args[2]) { $initArgs += @('--grade', [string]$args[2]) }
    & cotutor.cmd @initArgs
    if ($LASTEXITCODE -ne 0) { Stop-Here '建孩子的文件夹没成:看上面的报错。' }
    & cotutor.cmd service install
    Say ''
    Say '好了。家长端已经在浏览器里打开;以后点任务栏右下角 ^ 里的 cotutor 图标,或者跑 cotutor.cmd open。'
  } else {
    Say ''
    Say '接下来(短名用小写字母,不用真名;年级 1 到 6):'
    Say '  cotutor.cmd init ming --name 小明 --grade 2'
    Say '  cotutor.cmd service install'
  }
} catch {
  if ($_.Exception.Message -ne 'cotutor-install-stopped') { Write-Host ('出错了:' + $_.Exception.Message) }
}
