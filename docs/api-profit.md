# 流水看板接口与技能说明

## 功能边界

流水看板负责管理 `profits` 表里的项目流水和部门毛利。

- 数据源：`data/profit.db`
- 数据表：`profits`
- 前端模块：`src/modules/OpsModule.vue`
- 前端 API 封装：`src/api/profit.js`
- 后端路由：`server/routes/profit.cjs`
- 数据库脚本：`server/profit_db.py`

## 字段口径

| 字段 | 含义 |
| --- | --- |
| `grp` | 内容组，例如 `内容四组` |
| `project` | 投放产品/项目名称 |
| `platform` | 平台，例如 `抖音`、`B站`、`快手`、`代做` |
| `account` | 账号名称 |
| `revenue` | 流水/下单金额 |
| `margin` | 部门毛利，不是纯毛利 |
| `month` | 月份或档期，例如 `4月`、`4月上旬` |
| `remark` | 备注/链接 |

毛利规则：

- `代做`：`revenue * 100%`
- `B站`：`revenue * 60%`
- 其他平台：`revenue * 50%`

## 推荐接口

### 查询列表

```http
GET /api/profits?grp=内容四组
```

返回：

```json
{
  "data": [
    {
      "id": 1,
      "grp": "内容四组",
      "project": "逆水寒手游",
      "platform": "抖音",
      "account": "天机妹",
      "revenue": 12000,
      "margin": 6000,
      "month": "4月",
      "remark": "",
      "created_at": 1777285093
    }
  ]
}
```

### 新增记录

```http
POST /api/profits
Content-Type: application/json
```

```json
{
  "grp": "内容四组",
  "project": "逆水寒手游",
  "platform": "抖音",
  "account": "天机妹",
  "revenue": 12000,
  "margin": 6000,
  "month": "4月",
  "remark": ""
}
```

返回：

```json
{ "id": 73 }
```

### 修改记录

```http
PATCH /api/profits/:id
Content-Type: application/json
```

请求体同新增记录，不需要额外传 `id`。

### 删除记录

```http
DELETE /api/profits/:id
```

返回：

```json
{ "success": true }
```

### 统计汇总

```http
GET /api/profits/stats?grp=内容四组
```

返回：

```json
{
  "total_revenue": 126690,
  "total_margin": 50063,
  "count": 13
}
```

### 解析文本或 Excel

```http
POST /api/profits/parse
Content-Type: application/json
```

文本：

```json
{
  "text": "天机妹 逆水寒 3500元 4月上旬"
}
```

Excel：

```json
{
  "file_name": "profit.xlsx",
  "file_data": "base64..."
}
```

返回：

```json
{
  "records": [
    {
      "account": "天机妹",
      "project": "逆水寒",
      "platform": "抖音",
      "fee": 3500,
      "margin": 1750,
      "schedule": "4月上旬",
      "note": "天机妹 逆水寒 3500元 4月上旬"
    }
  ]
}
```

## 兼容接口

为了不影响旧页面或脚本，下面这些旧接口仍然保留：

- `GET/POST /api/profit/list`
- `POST /api/profit/add`
- `POST /api/profit/update`
- `POST /api/profit/delete`
- `GET/POST /api/profit/stats`
- `POST /api/profit/parse`
- `GET /api/feishu/profit`

新代码优先使用 `/api/profits...`。

## 对应技能

| 技能 | 输入 | 输出 | 负责文件 |
| --- | --- | --- | --- |
| 流水列表查询 | 内容组 | 项目列表 | `src/api/profit.js`、`server/routes/profit.cjs` |
| 毛利统计 | 内容组 | 流水、毛利、数量 | `server/profit_db.py` |
| 文本解析 | 确认信息文本 | 标准记录草稿 | `server/routes/profit.cjs` |
| Excel 解析 | `.xlsx/.xls` base64 | 标准记录草稿 | `server/routes/profit.cjs` |
| 记录 CRUD | 标准记录 | SQLite 数据 | `server/profit_db.py` |
| 飞书读取 | 飞书数据源 | 原始流水列表 | `server/feishu_profit.py` |

## 下一步建议

其他模块可以照这个模式拆：

1. `server/routes/<module>.cjs`
2. `src/api/<module>.js`
3. `docs/api-<module>.md`
4. 前端页面只调用 `src/api/*`，不直接写散落的 `fetch('/api/...')`
