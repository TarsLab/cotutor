/**
 * macOS 菜单栏图标的显示脚本:osascript -l JavaScript 跑,系统自带,不用签名、不用装东西(tray.ts 每次起来写到托盘目录再跑)。
 * 这里只管画和回报,不判断状态:从 stdin 收一行一条 JSON(show / notify / confirm / inspect / press / quit),从 stdout 回一行一条 JSON(ready / click / confirm / state)。
 * stdin 断了就退:看护它的 node 没了,图标也不该留着。
 * JXA 的坑(2026-11-06 在 macOS 27.2 上试的):$.NSAttributedString.alloc.initWithStringAttributes 不存在,要 NSMutableAttributedString.alloc.init 再填;枚举常量取不到值,写数字(NSImageScaleProportionallyUpOrDown = 3);返回整数的方法给的是字符串,比较前要 Number()。
 * 状态点是叠在按钮上的一层,系统的模板图才能继续跟着菜单栏深浅变;试过不挡点击。
 */
export const MAC_TRAY_SCRIPT = String.raw`ObjC.import('Cocoa');
const app = Application.currentApplication();
app.includeStandardAdditions = true;
const dir = $.NSProcessInfo.processInfo.environment.objectForKey('COTUTOR_TRAY_DIR').js;
const stdout = $.NSFileHandle.fileHandleWithStandardOutput;
const stdin = $.NSFileHandle.fileHandleWithStandardInput;
const emit = (o) => stdout.writeData($(JSON.stringify(o) + '\n').dataUsingEncoding($.NSUTF8StringEncoding));
let item, menu, tray, dotView, current = 'ok', pending = $.NSMutableData.alloc.init;
let ids = [];

const image = (name, size, template) => {
  const i = $.NSImage.alloc.initWithContentsOfFile($(dir + '/icons/' + name));
  i.setSize($.NSMakeSize(size, size));
  if (template) i.setTemplate(true);
  return i;
};
const styled = (text, font, color) => {
  const t = $.NSMutableAttributedString.alloc.init;
  t.replaceCharactersInRangeWithString($.NSMakeRange(0, 0), $(text));
  t.setAttributesRange($.NSDictionary.dictionaryWithObjectsForKeys($([font, color]), $([$.NSFontAttributeName, $.NSForegroundColorAttributeName])), $.NSMakeRange(0, text.length));
  return t;
};
function center() {
  const b = item.button.bounds;
  dotView.frame = $.NSMakeRect((b.size.width - 18) / 2, (b.size.height - 18) / 2, 18, 18);
}
function fill(entries) {
  menu.removeAllItems;
  ids = [];
  for (const e of entries) {
    if (e.kind === 'sep') { menu.addItem($.NSMenuItem.separatorItem); continue; }
    const m = $.NSMenuItem.alloc.initWithTitleActionKeyEquivalent($(e.title), e.kind === 'action' ? 'clicked:' : null, $(''));
    if (e.kind === 'action') {
      m.target = tray;
      m.enabled = true;
      // 标号从 1 起:别的行缺省是 0,按标号找会找到它们
      ids.push(e.id);
      m.tag = ids.length;
      if (e.primary) m.attributedTitle = styled(e.title, $.NSFont.boldSystemFontOfSize(13), $.NSColor.labelColor);
    } else if (e.kind === 'info') {
      m.enabled = false;
      m.attributedTitle = styled(e.title, $.NSFont.boldSystemFontOfSize(13), $.NSColor.labelColor);
      if (e.level) m.image = image('dot-' + e.level + '.png', 10, false);
    } else {
      m.enabled = false;
      m.attributedTitle = styled(e.title, $.NSFont.systemFontOfSize(11), $.NSColor.secondaryLabelColor);
    }
    menu.addItem(m);
  }
}
function show(m) {
  current = m.icon;
  dotView.setHidden(m.icon === 'ok');
  dotView.contentTintColor = m.icon === 'warn' ? $.NSColor.systemOrangeColor : $.NSColor.systemRedColor;
  item.button.appearsDisabled = m.icon === 'bad';
  item.button.toolTip = $(m.tip);
  fill(m.menu);
  center();
}
function quit() {
  $.NSStatusBar.systemStatusBar.removeStatusItem(item);
  $.NSApp.terminate(null);
}
function confirm(m) {
  const a = $.NSAlert.alloc.init;
  a.messageText = $(m.title);
  a.informativeText = $(m.body);
  // 第一个按钮是回车默认的那个:默认不退出
  a.addButtonWithTitle($(m.no));
  a.addButtonWithTitle($(m.yes));
  $.NSApp.activateIgnoringOtherApps(true);
  // 桥接把整数返回成字符串("1001"),不转就永远不等
  emit({ type: 'confirm', id: m.id, yes: Number(a.runModal) === 1001 });
}
function handle(m) {
  if (m.type === 'show') show(m);
  else if (m.type === 'notify') { try { app.displayNotification(m.body, { withTitle: m.title }); } catch (e) { emit({ type: 'error', message: String(e) }); } }
  else if (m.type === 'confirm') confirm(m);
  else if (m.type === 'quit') quit();
  else if (m.type === 'inspect') {
    const titles = [];
    for (let i = 0; i < menu.numberOfItems; i++) titles.push(menu.itemAtIndex(i).title.js);
    emit({ type: 'state', icon: current, dot: !dotView.isHidden, dim: item.button.appearsDisabled, visible: (item.button.window.occlusionState & 2) === 2, appearance: item.button.effectiveAppearance.name.js, menu: titles });
  } else if (m.type === 'press') {
    const n = ids.indexOf(m.id);
    if (n >= 0) { const at = menu.indexOfItemWithTag(n + 1); if (at >= 0) menu.performActionForItemAtIndex(at); }
  }
}
function received() {
  const data = stdin.availableData;
  if (Number(data.length) === 0) { quit(); return; }
  pending.appendData(data);
  const text = $.NSString.alloc.initWithDataEncoding(pending, $.NSUTF8StringEncoding);
  // 一个汉字被切在两块之间时解不出来:等下一块
  if (!text.isNil()) {
    const lines = text.js.split('\n');
    const rest = lines.pop();
    pending = $.NSMutableData.alloc.init;
    if (rest) pending.appendData($(rest).dataUsingEncoding($.NSUTF8StringEncoding));
    for (const line of lines) {
      if (!line) continue;
      try { handle(JSON.parse(line)); } catch (e) { emit({ type: 'error', message: String(e) }); }
    }
  }
  stdin.waitForDataInBackgroundAndNotify;
}
ObjC.registerSubclass({
  name: 'CotutorTray',
  methods: {
    'clicked:': { types: ['void', ['id']], implementation: function (sender) { emit({ type: 'click', id: ids[Number(sender.tag) - 1] }); } },
    'received:': { types: ['void', ['id']], implementation: function () { received(); } },
  },
});
const nsapp = $.NSApplication.sharedApplication;
nsapp.setActivationPolicy($.NSApplicationActivationPolicyAccessory);
tray = $.CotutorTray.alloc.init;
item = $.NSStatusBar.systemStatusBar.statusItemWithLength(28);
item.button.image = image('logo.png', 18, true);
item.button.setAccessibilityLabel($('cotutor'));
dotView = $.NSImageView.alloc.initWithFrame($.NSMakeRect(5, 2, 18, 18));
dotView.image = image('dotmark.png', 18, true);
dotView.imageScaling = 3;
dotView.setHidden(true);
item.button.addSubview(dotView);
menu = $.NSMenu.alloc.init;
menu.autoenablesItems = false;
item.menu = menu;
center();
$.NSNotificationCenter.defaultCenter.addObserverSelectorNameObject(tray, 'received:', $.NSFileHandleDataAvailableNotification, stdin);
stdin.waitForDataInBackgroundAndNotify;
emit({ type: 'ready' });
nsapp.run;
`;
