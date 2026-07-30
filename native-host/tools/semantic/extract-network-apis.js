// 自动捕获网络请求，按域名过滤，返回结构化 API 列表

/**
 * @param {object} ctx - { sendToExtension(taskId, action, payload): Promise<any>, currentUrl: string }
 * @param {object} params - { domain_filter?, capture_duration_ms?, include_request_body? }
 * @returns {Promise<object>}
 */
export async function extractNetworkApis(ctx, params = {}) {
  const { domain_filter, capture_duration_ms = 3000, include_request_body = false } = params;
  const taskId = `net_${Date.now()}`;

  await ctx.sendToExtension(taskId, 'network_start', {});
  await new Promise(r => setTimeout(r, Math.min(capture_duration_ms, 30000)));
  const result = await ctx.sendToExtension(taskId, 'network_stop', {});

  const data = result.data || {};
  const requests = data.requests || [];

  let filtered = requests;
  if (domain_filter) {
    filtered = requests.filter(r => {
      try { return new URL(r.url).hostname.includes(domain_filter); } catch { return false; }
    });
  }

  const seen = new Set();
  const apis = filtered.filter(r => {
    const key = `${r.method}:${r.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(r => ({
    url: r.url,
    method: r.method || 'GET',
    status: r.status,
    type: r.type || 'fetch',
    mime_type: r.mimeType || '',
    response_size_bytes: r.responseSize || 0,
    timing_ms: r.timing || 0,
  }));

  const domains = [...new Set(apis.map(a => {
    try { return new URL(a.url).hostname; } catch { return ''; }
  }).filter(Boolean))];

  return {
    total_requests: requests.length,
    filtered_requests: apis.length,
    domains,
    apis,
  };
}
