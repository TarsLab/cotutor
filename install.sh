#!/bin/sh
# cotutor 一行安装(macOS、Linux):
#   curl -fsSL https://raw.githubusercontent.com/TarsLab/cotutor/main/install.sh | sh
# 连不上 GitHub 就换这个:
#   curl -fsSL https://cdn.jsdelivr.net/npm/cotutor@latest/install.sh | sh
# 顺手建好孩子的文件夹、装好后台服务(短名 称呼 年级):
#   curl -fsSL https://raw.githubusercontent.com/TarsLab/cotutor/main/install.sh | sh -s -- ming 小明 2
#
# 只做这几件事:查 Node 的版本;npm 连不上就用国内镜像;全局目录写不了就换到自己家目录下(不用 sudo);装 cotutor。
# 不用 sudo,不改系统设置。Node 没装或太旧时只说怎么装,不替你装。
set -eu

say() { printf '%s\n' "$*"; }
die() { say "$*"; exit 1; }

NEED_MAJOR=22
NEED_MINOR=18

# ---- 1. Node ----
command -v node >/dev/null 2>&1 || die "这台电脑还没有 Node.js:到 https://nodejs.org 下载 LTS 版装上,重开终端再跑这一行。"
v=$(node -p 'process.versions.node')
major=${v%%.*}
rest=${v#*.}
minor=${rest%%.*}
if [ "$major" -lt "$NEED_MAJOR" ] || { [ "$major" -eq "$NEED_MAJOR" ] && [ "$minor" -lt "$NEED_MINOR" ]; }; then
  die "Node.js 是 $v,cotutor 要 $NEED_MAJOR.$NEED_MINOR 以上:到 https://nodejs.org 装新的 LTS 版,重开终端再跑这一行。"
fi
command -v npm >/dev/null 2>&1 || die "有 Node.js 但找不到 npm:到 https://nodejs.org 重新装一次 LTS 版。"
say "Node.js $v"

# ---- 2. npm 连得上吗(国内常连不上,换镜像) ----
REGISTRY=""
if ! curl -fsS -o /dev/null --max-time 8 https://registry.npmjs.org/cotutor/latest 2>/dev/null; then
  REGISTRY="https://registry.npmmirror.com"
  say "npm 连不上或太慢,用国内镜像 $REGISTRY"
fi

# ---- 3. 全局目录写得了吗(官网的 Mac 安装包装在 /usr/local,要 sudo 才能写;不用 sudo,换到家目录下) ----
root=$(npm root -g)
target=$root
[ -d "$target" ] || target=$(dirname "$target")
if [ ! -w "$target" ]; then
  prefix="$HOME/.npm-global"
  say "npm 的全局目录 $root 这个账户写不了,改装到 $prefix(不用 sudo)"
  mkdir -p "$prefix"
  npm config set prefix "$prefix"
  case "${SHELL:-}" in
    */zsh) rc="$HOME/.zshrc" ;;
    */bash) if [ "$(uname)" = Darwin ]; then rc="$HOME/.bash_profile"; else rc="$HOME/.bashrc"; fi ;;
    *) rc="$HOME/.profile" ;;
  esac
  line='export PATH="$HOME/.npm-global/bin:$PATH"'
  if ! grep -qsF "$line" "$rc"; then
    printf '\n# cotutor 安装脚本加的:npm 全局命令装在家目录下\n%s\n' "$line" >> "$rc"
    say "在 $rc 里加了一行 PATH,新开的终端就认得 cotutor"
  fi
  PATH="$prefix/bin:$PATH"
  export PATH
fi

# ---- 4. 装 ----
say "正在下载 cotutor,要一会儿……"
if [ -n "$REGISTRY" ]; then npm i -g cotutor --no-audit --no-fund --registry="$REGISTRY"; else npm i -g cotutor --no-audit --no-fund; fi
command -v cotutor >/dev/null 2>&1 || die "装好了但找不到 cotutor 命令:重开终端再试;还不行,把 $(npm prefix -g)/bin 加进 PATH。"
say "cotutor $(cotutor --version) 装好了"

# ---- 5. 带了孩子的信息就接着建文件夹、装后台服务 ----
if [ $# -ge 1 ]; then
  slug=$1
  set -- "$@" "" ""
  name=$2
  grade=$3
  if [ -n "$name" ] && [ -n "$grade" ]; then cotutor init "$slug" --name "$name" --grade "$grade"
  elif [ -n "$name" ]; then cotutor init "$slug" --name "$name"
  else cotutor init "$slug"; fi
  cotutor service install
  say ""
  say "好了。家长端已经在浏览器里打开;以后点菜单栏的 cotutor 图标,或在终端跑 cotutor open。"
else
  say ""
  say "接下来(短名用小写字母,不用真名;年级 1 到 6):"
  say "  cotutor init ming --name 小明 --grade 2"
  say "  cotutor service install"
fi
