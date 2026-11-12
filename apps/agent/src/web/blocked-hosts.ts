/**
 * Hosts the agents' browser may not reach, nor load anything from: services made to catch
 * requests or post text anonymously, through which an agent steered by a page could send the
 * user's data out. A host is blocked along with every subdomain of it. Change the list here.
 */
export const BLOCKED_HOSTS: readonly string[] = [
  // Request catchers and webhook inspectors.
  "webhook.site",
  "requestbin.com",
  "requestbin.net",
  "requestcatcher.com",
  "pipedream.net",
  "beeceptor.com",
  "hookbin.com",
  "mockbin.org",
  "postb.in",
  "ptsv2.com",
  "ptsv3.com",
  "httpdump.app",
  "webhook.cool",
  // Out-of-band interaction servers used to confirm that a request went out.
  "interact.sh",
  "oast.fun",
  "oast.live",
  "oast.me",
  "oast.online",
  "oast.pro",
  "oast.site",
  "burpcollaborator.net",
  "oastify.com",
  "canarytokens.com",
  "dnslog.cn",
  // Tunnels that expose anyone's local server under a public name.
  "ngrok.io",
  "ngrok-free.app",
  "ngrok.app",
  "trycloudflare.com",
  "loca.lt",
  "serveo.net",
  "localhost.run",
  // Anonymous pastes.
  "pastebin.com",
  "paste.ee",
  "hastebin.com",
  "0x0.st",
  "transfer.sh",
];

/**
 * Whether the browser may not reach `url`: a host on `BLOCKED_HOSTS` or under one, or an address
 * given as an IP instead of a name, which no list of names could cover.
 */
export function isBlocked(url: string, blocked: readonly string[] = BLOCKED_HOSTS): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return true;
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[")) {
    return true;
  }
  return blocked.some((name) => host === name || host.endsWith(`.${name}`));
}
