// 导出当前页面 Cookie 为 Netscape 或 JSON 格式

/**
 * @param {object} ctx - { sendToExtension(taskId, action, payload): Promise<any>, currentUrl: string }
 * @param {object} params - { domain?, format? }
 * @returns {Promise<object>}
 */
export async function getAuthCookies(ctx, params = {}) {
  const { domain, format = 'netscape' } = params;
  const taskId = `ck_${Date.now()}`;

  const result = await ctx.sendToExtension(taskId, 'evaluate', {
    value: 'document.cookie',
  });

  const cookieStr = result.data?.result || '';
  const rawCookies = cookieStr.split(';').map(c => c.trim()).filter(Boolean);

  const targetDomain = domain || (() => {
    try { return new URL(ctx.currentUrl || 'about:blank').hostname; }
    catch { return ''; }
  })();

  if (format === 'netscape') {
    const lines = ['# Netscape HTTP Cookie File'];
    for (const ck of rawCookies) {
      const parts = ck.split('=');
      if (parts.length < 2) continue;
      const name = parts[0];
      const value = parts.slice(1).join('=');
      lines.push(`${targetDomain.startsWith('.') ? targetDomain : '.' + targetDomain}\tTRUE\t/\tTRUE\t0\t${name}\t${value}`);
    }
    return { format: 'netscape', domain: targetDomain, cookie_count: rawCookies.length, raw: lines.join('\n') };
  }

  return {
    format: 'json',
    domain: targetDomain,
    cookie_count: rawCookies.length,
    cookies: rawCookies.map(c => {
      const [name, ...rest] = c.split('=');
      return { name, value: rest.join('=') };
    }),
  };
}
