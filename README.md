# ICU Anesthesia Project

面向重症与手麻信息化实施场景的项目管理平台，提供项目台账、阶段任务、问题与接口跟踪、审批协同、资源排班、经营看板、AI 分析与移动端速查能力。

## 当前范围

- Web 主工作台：项目详情、审批中心、提醒中心、资源视图、经营看板、交付地图
- 任务中心：统一查看 AI 分析、项目周报、报告归档、知识提炼、晨会简报、AI 巡航等后台任务
- 移动端：项目速查卡、每日简报、AI 问答、快速日志、沟通速记、验收检查
- 企业微信集成：审批流、消息推送、移动入口
- 数据层：SQLite / PostgreSQL 双模式

## 主要入口

- 首页：`/`
- 任务中心：`/tasks-center`
- 对齐中心：`/alignment`
- 移动端首页：`/m/`

## 技术栈

- Python 3.10+
- Flask
- PostgreSQL / SQLite
- 原生 HTML / JS
- ECharts
- 企业微信接口
- 多模型 AI 接口适配

## 快速启动

```bash
git clone https://github.com/QS1314520ZHOU/icu_anesthesia_project.git
cd icu_anesthesia_project
pip install -r requirements.txt
python app.py
```

默认访问：

```text
http://localhost:5000
```

## PostgreSQL 模式

在 `.env` 中配置数据库参数，或直接配置 `DATABASE_URL`。

示例：

```env
DB_TYPE=postgres
DB_HOST=localhost
DB_PORT=5432
DB_NAME=icu_pm
DB_USER=postgres
DB_PASSWORD=your_password
```

初始化表结构：

```bash
python init_pg.py
```

如需从 SQLite 迁移：

```bash
python migrate_sqlite_to_pg.py
```

## 仓库说明

- `app.py`：主应用入口与部分核心 API
- `routes/`：按业务域拆分的路由
- `services/`：业务逻辑与 AI / 企业微信 / 报告 / 调度服务
- `templates/`：桌面端与移动端页面
- `static/js/`：前端脚本与模块化 hub 文件
- `utils/`：通用工具函数

## 交付辅助文档

- `CURRENT_STATUS.md`
- `FEATURE_MAP.md`
- `HUB_MODULES.md`
- `LEGACY_FRONTEND_NOTES.md`
- `TEST_CHECKLIST.md`

## 注意事项

- `.env`、数据库文件、上传文件、临时下载、临时报表、校验产物不会提交到仓库
- 生产环境建议使用 PostgreSQL
- 企业微信、对象存储、AI 接口均依赖本地配置
