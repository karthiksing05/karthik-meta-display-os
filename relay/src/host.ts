import { execFile } from 'node:child_process';
import type { HostInfo } from '../../shared/protocol.ts';

/** Battery and Wi-Fi of the Mac running the relay (macOS: pmset / networksetup / ipconfig). */
const run = (cmd: string, args: string[]) =>
  new Promise<string>((res) => execFile(cmd, args, { timeout: 4000 }, (_e, out) => res(String(out ?? ''))));

let wifiDev: string | null | undefined;

export async function readHost(): Promise<HostInfo> {
  const info: HostInfo = { battery: null, charging: false, wifi: null };
  if (process.platform !== 'darwin') return info;

  const batt = await run('pmset', ['-g', 'batt']);
  const m = batt.match(/(\d+)%;\s*([a-z ]+);/i);
  if (m) {
    info.battery = Number(m[1]);
    info.charging = /charging|charged|finishing/i.test(m[2]) && !/discharging/i.test(m[2]) || /AC Power/.test(batt);
  }

  if (wifiDev === undefined) {
    const ports = await run('networksetup', ['-listallhardwareports']);
    wifiDev = ports.match(/Hardware Port: Wi-Fi\s*\nDevice: (\S+)/)?.[1] ?? null;
  }
  if (wifiDev) {
    const power = await run('networksetup', ['-getairportpower', wifiDev]);
    if (/:\s*Off/i.test(power)) info.wifi = 'off';
    else {
      const ip = (await run('ipconfig', ['getifaddr', wifiDev])).trim();
      info.wifi = ip ? 'connected' : 'down';
      if (ip) {
        // macOS redacts the network name unless the relay's terminal has Location access.
        const ssid = (await run('ipconfig', ['getsummary', wifiDev])).match(/^\s*SSID : (.+)$/m)?.[1]?.trim();
        if (ssid && ssid !== '<redacted>') info.ssid = ssid;
      }
    }
  }
  return info;
}
