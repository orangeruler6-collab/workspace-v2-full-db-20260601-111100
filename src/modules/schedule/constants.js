export const STATUS_MAP = { pending: '待发布', done: '已发布', delayed: '延期' }
export const TYPE_TAG = { '日常': '日常', '商单': '商单', '一口价': '一口价', '星广联投': '星广', 'CPM': 'CPM', '素材代做': '素材代做' }
export const WORKFLOW_STAGES = ['文案', '后期', '待发布', '已发布', '延期']

export const GROUPS = [
  { id: 1, label: '内容一组', members: ['许树杰', '许梦婷', '刘登魁', '许国锬', '叶进生', '高明镇', '薛荐轩', '叶颖'], accounts: ['花无缺', '葵仔不想肝', '最翁说游', '薛定谔的机', '跑腿的包子', '李野王SG', '游电工厂', '硬件侠', '素材'] },
  { id: 2, label: '内容二组', members: ['傅思敏', '赵良杰', '陈乐恒', '吴恒', '李扬林', '施律彬', '罗晓棋'], accounts: ['痞仔伯爵', '暴走星号键', '雷鸭Fist', '报告砖家', '沙雕101', '灵梦小师妹', '网瘾少女一条', '素材'] },
  { id: 3, label: '内容三组', members: ['曹媛', '陈泓睿', '林文涛', '刘佳琳', '肖子璇'], accounts: ['苏大强', '中二探长', '团子好贵', '嘿小虎', '饭十七', '皮皮说游戏', '素材'] },
  { id: 4, label: '内容四组', members: ['姚希', '陈健伊', '宋丽佳', '林宇辰'], accounts: ['天机妹', '花蛮楼', '麦晓花', '夏天丶Cat', '有事找学姐', '小张同学', '素材'] },
  { id: 5, label: '内容五组', members: ['朱信宇', '林心语', '商光涵', '杨鸿霆', '吴楷煌'], accounts: ['游小妹', '游热娃子', '超玩教授', 'Lee小强', '尼大木', '麦冬冬', '素材'] },
  { id: 6, label: '内容六组', members: ['廖李星', '吴皓轩', '林孝添', '林语婷', '张碧珊', '叶子健'], accounts: ['不玩就分手', '游点慌', '游戏永动机', '畅玩百晓生', '夏洛', '游侠蹦蹦', '王路飞cp', '上官北丶', '情风师兄', '素材'] },
]

export const MEMBERS = Array.from(new Set(GROUPS.flatMap(group => group.members)))
export const ALL_ACCOUNTS = Array.from(new Set(GROUPS.flatMap(group => group.accounts)))
