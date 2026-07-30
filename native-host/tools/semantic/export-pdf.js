// 导出当前页面为 PDF，使用 CDP Page.printToPDF

/**
 * @param {object} ctx - { sendToExtension(taskId, action, payload): Promise<any> }
 * @param {object} params - { landscape?, paper_size?, print_background?, scale? }
 * @returns {Promise<object>}
 */
export async function exportPdf(ctx, params = {}) {
  const { landscape = false, paper_size = 'A4', print_background = true, scale = 1.0 } = params;
  const taskId = `pdf_${Date.now()}`;

  const result = await ctx.sendToExtension(taskId, 'evaluate', {
    value: JSON.stringify({
      action: 'pdf_export',
      params: {
        landscape,
        paperWidth: paper_size === 'A4' ? 8.27 : paper_size === 'Letter' ? 8.5 : 8.5,
        paperHeight: paper_size === 'A4' ? 11.69 : paper_size === 'Letter' ? 11 : 14,
        printBackground: print_background,
        scale: Math.min(Math.max(scale, 0.1), 2.0),
      },
    }),
  });

  const data = result.data || {};
  return {
    status: data.error ? 'error' : 'success',
    page_count: data.pageCount || 0,
    raw_bytes: data.pdfData || null,
    error: data.error || null,
  };
}
