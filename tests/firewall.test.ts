/**
 * Windows 防火墙(src/app/cli/firewall.ts):查回来的样子 → 平板连不连得进来、怎么修。真查要 Windows 与 PowerShell,这里只测解析与判断;
 * 2026-10-31 那台 Windows 的样子(专用网络、防火墙开着、没有 node 也没有端口的规则)是「没放行」那一条。
 */
import { firewallScript, judgeFirewall, parseFirewall, type FirewallState } from '../src/app/cli/firewall.ts';
import { check, done } from './_check.ts';

const node = 'C:\\Program Files\\nodejs\\node.exe';
const on = ['Domain', 'Private', 'Public'];
const judge = (s: Partial<FirewallState>) => judgeFirewall({ networks: ['Private'], enabled: on, allowed: [], blocked: [], ...s }, 5180, node);

const none = judge({});
check('专用网络、防火墙开着、没有规则 → 没放行,给管理员终端里的 netsh 放行端口', !none.ok && none.detail.includes('5180') && (none.fix ?? '').includes('netsh advfirewall firewall add rule name="cotutor" dir=in action=allow protocol=TCP localport=5180 profile=private'), JSON.stringify(none));
check('放行规则覆盖专用 → 连得进来', judge({ allowed: ['Private'] }).ok && judge({ allowed: ['Domain, Private'] }).ok && judge({ allowed: ['Any'] }).ok);
check('放行规则只覆盖公用、网络是专用 → 还是没放行', !judge({ allowed: ['Public'] }).ok);
const blocked = judge({ allowed: ['Private'], blocked: ['Private, Public'] });
check('拦着这个 node(点过取消)→ 先删拦截规则再放行,拦截压过放行', !blocked.ok && (blocked.fix ?? '').includes(`delete rule name=all dir=in program="${node}"`) && (blocked.fix ?? '').includes('localport=5180'), JSON.stringify(blocked));
const pub = judge({ networks: ['Public'], allowed: ['Private'] });
check('网络是公用 → 让改成专用(专用的放行管不到公用)', !pub.ok && pub.detail.includes('公用') && (pub.fix ?? '').includes('专用'), JSON.stringify(pub));
check('防火墙在连着的网络上关着 → 连得进来', judge({ enabled: ['Domain', 'Public'] }).ok);
check('域网络按 Domain 算', judge({ networks: ['DomainAuthenticated'], enabled: ['Domain'], allowed: ['Domain'] }).ok && !judge({ networks: ['DomainAuthenticated'], enabled: ['Domain'] }).ok);
check('没连网络 → 不报', judge({ networks: [] }).ok);

check('PowerShell 的 JSON:一个元素的数组拆成了字符串、null 当空', JSON.stringify(parseFirewall('{"networks":"Private","enabled":["Domain","Private"],"allowed":null,"blocked":[]}\r\n')) === JSON.stringify({ networks: ['Private'], enabled: ['Domain', 'Private'], allowed: [], blocked: [] }));
check('回的不是 JSON → null(查不了就不报)', parseFirewall('') === null && parseFirewall('Get-NetConnectionProfile : 拒绝访问') === null);
const script = firewallScript("C:\\it's\\node.exe", 5180);
check('脚本:路径里的单引号写两个,端口写进去', script.includes("$node = 'C:\\it''s\\node.exe'") && script.includes("$port = '5180'"));

done();
