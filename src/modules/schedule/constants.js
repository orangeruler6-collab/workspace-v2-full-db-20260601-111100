export const STATUS_MAP = { pending: '待发布', done: '已发布', delayed: '延期' }
export const TYPE_TAG = { '日常': '日常', '商单': '商单', '一口价': '一口价', '星广联投': '星广', 'CPM': 'CPM', '素材代做': '素材代做' }
export const WORKFLOW_STAGES = ['文案', '后期', '待发布', '已发布', '延期']

export const GROUPS = [
  { id: 1, label: '内容一部', aliases: ['内容一组'], leader: '薛荐轩', members: ['薛荐轩', '廖李星', '高明镇', '林孝添', '叶子健', '许国锬', '许树杰', '林语婷', '许梦婷'], accounts: ['最游话说', '薛定谔的机', '李野王SG', '游电工厂', '硬件侠', '情风师兄', '上官北丶', '王路飞CP', '素材'] },
  { id: 2, label: '内容二组', leader: '傅思敏', members: ['傅思敏', '赵良杰', '陈乐恒', '吴恒', '李扬林', '施律彬', '罗晓棋'], accounts: ['痞仔伯爵', '暴走星号键', '雷鸭Fist', '报告砖家', '沙雕101', '网瘾少女一条', '素材'] },
  { id: 3, label: '内容三组', leader: '曹媛', members: ['曹媛', '陈泓睿', '林文涛', '刘佳琳', '肖子璇'], accounts: ['策划克星阿强', '中二探长', '团子好贵', '嘿小虎', '灵梦小师妹', '跑腿的包子', '饭十七', '皮皮说游戏', '娱乐小狮酱', '甄有话说', '素材'] },
  { id: 4, label: '内容四组', leader: '陈健伊', members: ['姚希', '陈健伊', '宋丽佳', '林宇辰'], accounts: ['天机妹', '花蛮楼', '麦小雯', '夏天丶Cat', '有事找学姐', '小张同学', '素材'] },
  { id: 5, label: '内容五组', leader: '杨鸿霆', members: ['朱信宇', '林心语', '商光涵', '杨鸿霆', '吴楷煌'], accounts: ['游小妹', '游热娃子', '超玩教授', 'Lee小强', '木游话说', '麦冬冬', '素材'] },
  { id: 6, label: '内容六组', leader: '刘登魁', members: ['张莹珊', '刘思嫚', '吴皓轩', '邓姝', '叶进生', '叶颖', '刘登魁'], accounts: ['花无缺', '葵仔不想肝', '游戏永动机', '畅玩百晓生', '素材'] },
  { id: 7, label: 'MCN经纪组', aliases: ['MCN经济组', '经济组'], leader: '', members: ['张家豪', '钟文祯', '龙星羽', '吴羿玄'], accounts: ['素材'] },
]

export const MEMBERS = Array.from(new Set(GROUPS.flatMap(group => group.members)))
export const ALL_ACCOUNTS = Array.from(new Set(GROUPS.flatMap(group => group.accounts)))
