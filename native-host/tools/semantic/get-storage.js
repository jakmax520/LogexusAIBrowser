// 读取页面 localStorage 和 sessionStorage

/**
 * @param {object} ctx - { sendToExtension(taskId, action, payload): Promise<any> }
 * @param {object} params - { include?, key_prefix?, max_value_length? }
 * @returns {Promise<object>}
 */
export async function getStorage(ctx, params = {}) {
  const { include = 'both', key_prefix, max_value_length = 200 } = params;
  const taskId = `st_${Date.now()}`;

  const result = await ctx.sendToExtension(taskId, 'evaluate', {
    value: `(() => {
      const out = {};
      const stores = ${JSON.stringify(include === 'both' ? ['local', 'session'] : [include])};
      const prefix = ${JSON.stringify(key_prefix || '')};
      const maxLen = ${max_value_length};
      for (const s of stores) {
        const storage = s === 'local' ? localStorage : sessionStorage;
        const entries = {};
        try {
          for (let i = 0; i < storage.length; i++) {
            const k = storage.key(i);
            if (prefix && !k.startsWith(prefix)) continue;
            let v = storage.getItem(k) || '';
            if (v.length > maxLen) v = v.slice(0, maxLen) + '...[truncated]';
            entries[k] = v;
          }
        } catch (e) {}
        out[s + 'Storage'] = {
          count: storage.length,
          filtered_count: Object.keys(entries).length,
          entries,
        };
      }
      return JSON.stringify(out);
    })()`,
  });

  try {
    return JSON.parse((result.data?.result || '{}'));
  } catch {
    return { error: 'Failed to parse storage data' };
  }
}
