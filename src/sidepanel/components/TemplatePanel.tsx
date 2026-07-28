// ── 指令模板面板 ──

interface Props {
  onSelect: (template: Template) => void;
}

export interface Template {
  name: string;
  description: string;
  steps: { action: string; target_desc: string; value?: string }[];
}

const TEMPLATES: Template[] = [
  {
    name: 'Bing 搜索测试',
    description: '在 Bing 搜索框输入 OpenAI 并点击搜索',
    steps: [
      { action: 'observe', target_desc: '获取页面元素' },
      { action: 'type', target_desc: '搜索输入框 (input[type=search])', value: 'OpenAI' },
      { action: 'observe', target_desc: '确认输入' },
      { action: 'click', target_desc: '搜索按钮 (含 search 文字的 button)' },
    ],
  },
  {
    name: '竞品融资采集',
    description: '在 Crunchbase 搜索 AI 融资超 5000 万的公司',
    steps: [
      { action: 'navigate', target_desc: '打开 Crunchbase', value: 'https://www.crunchbase.com' },
      { action: 'observe', target_desc: '获取首页元素' },
      { action: 'type', target_desc: '搜索框', value: 'AI startup funding over 50M' },
      { action: 'click', target_desc: '搜索按钮' },
      { action: 'observe', target_desc: '获取搜索结果' },
      { action: 'extract', target_desc: '提取公司列表', value: '.company-name, h3, .entity-title' },
    ],
  },
  {
    name: 'SEO 批量查询',
    description: '在 Semrush 中查询域名 DA/PA 指标',
    steps: [
      { action: 'navigate', target_desc: '打开 Semrush', value: 'https://www.semrush.com/analytics/overview/' },
      { action: 'observe', target_desc: '获取页面元素' },
      { action: 'type', target_desc: '域名输入框', value: 'example.com' },
      { action: 'click', target_desc: '搜索/分析按钮' },
      { action: 'observe', target_desc: '获取分析结果' },
      { action: 'extract', target_desc: '提取指标数据', value: '.metric-value, [data-metric]' },
    ],
  },
  {
    name: 'CRM 数据回填',
    description: '从 A 系统提取数据并填入 B 系统表单',
    steps: [
      { action: 'observe', target_desc: '获取源系统页面' },
      { action: 'extract', target_desc: '提取目标数据', value: '.data-field' },
      { action: 'navigate', target_desc: '打开目标 CRM', value: 'newtab: https://crm.example.com/new' },
      { action: 'observe', target_desc: '获取 CRM 表单' },
      { action: 'type', target_desc: '公司名输入框', value: '$extracted.company_name' },
      { action: 'type', target_desc: '金额输入框', value: '$extracted.amount' },
      { action: 'click', target_desc: '提交按钮' },
    ],
  },
];

export function TemplatePanel({ onSelect }: Props) {
  return (
    <div className="border-t border-gray-200 dark:border-gray-700 p-3">
      <h3 className="text-xs font-medium text-gray-500 mb-2 flex items-center gap-1">
        📋 指令模板
        <span className="text-[10px] text-gray-400 font-normal ml-1">
          ({TEMPLATES.length})
        </span>
      </h3>

      <div className="space-y-1.5 max-h-[200px] overflow-y-auto scroll-thin">
        {TEMPLATES.map((tpl) => (
          <button
            key={tpl.name}
            className="w-full text-left p-2 rounded-lg border border-gray-200 dark:border-gray-700
                       bg-white dark:bg-[#2D2D2D] hover:border-primary-400 dark:hover:border-primary-600
                       transition-colors group"
            onClick={() => onSelect(tpl)}
          >
            <div className="text-xs font-medium group-hover:text-primary-500">
              {tpl.name}
            </div>
            <div className="text-[10px] text-gray-400 mt-0.5">{tpl.description}</div>
            <div className="text-[10px] text-gray-500 mt-1">
              {tpl.steps.length} 步
              {' · '}
              {tpl.steps.map((s) => s.action).filter((v, i, a) => a.indexOf(v) === i).join(' → ')}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
