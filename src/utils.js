/**
 * Mask the last octet/group of an IP address so responses do not expose
 * the full client IP. The stored value is never modified.
 *
 * IPv4: 192.168.1.42   -> 192.168.1.xxx
 * IPv6: 2001:db8::1     -> 2001:db8::xxx
 *
 * Non-string, empty, or unrecognized input is returned unchanged.
 *
 * @param {string|null|undefined} ip
 * @returns {string|null|undefined}
 */
function maskIp(ip) {
  if (typeof ip !== 'string' || ip.length === 0) {
    return ip;
  }

  // IPv4: mask the last octet.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    return ip.replace(/\.\d{1,3}$/, '.xxx');
  }

  // IPv6: mask the last group (handles compressed forms like ::1).
  if (ip.includes(':')) {
    const lastColon = ip.lastIndexOf(':');
    return ip.slice(0, lastColon + 1) + 'xxx';
  }

  return ip;
}

module.exports = { maskIp };
