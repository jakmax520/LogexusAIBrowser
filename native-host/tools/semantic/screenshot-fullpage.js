// 全页截图，使用 CDP Page.captureScreenshot({captureBeyondViewport: true})

/**
 * @param {object} ctx - { sendToExtension(taskId, action, payload): Promise<any> }
 * @param {object} params - { max_height_px?, format?, quality? }
 * @returns {Promise<object>}
 */
export async function screenshotFullpage(ctx, params = {}) {
  const { max_height_px = 16384, format = 'png', quality = 80 } = params;
  const taskId = `ss_${Date.now()}`;

  const result = await ctx.sendToExtension(taskId, 'screenshot', {
    full_page: true,
    max_height: Math.min(max_height_px, 32768),
    format,
    quality: format === 'jpeg' ? Math.min(Math.max(quality, 1), 100) : undefined,
  });

  const data = result.data || {};
  return {
    status: data.error ? 'error' : 'success',
    width_px: data.width || 0,
    height_px: data.height || 0,
    raw_bytes: data.screenshot || null,
    error: data.error || null,
    format,
  };
}
