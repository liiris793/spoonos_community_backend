# SpoonOS Community Contribution Bot

面向 SpoonOS Community Contribution Program · Season 2 的模块化 Discord Bot。

当前 MVP 已包含：

- 23 个 Season 2 初始任务
- 任务创建、修改、复制、发布、暂停、关闭和归档
- 任务版本管理，积分修改不追溯历史提交
- 任务领取和证明提交
- Python/uv 规则预审与可选 AI 建议（人工最终审核）
- 人工审核、退回修改和驳回
- UTC日期范围的CSV/XLSX批量审核与防重复积分结算
- 0.5 / 1 / 1.25 / 1.5 质量系数
- 不可变积分流水
- 用户等级、个人进度和 Top 10 排行榜
- 指定频道消息采集、UTC 日结预审与批量人工结算
- 用户、任务、提交、积分和内容资产 CSV 导出
- 蓝白配色的任务中心与排行榜网页

## 1. 本地启动

```bash
npm install
cp .env.example .env
npm run seed
npm run deploy:commands
npm run dev
```

`npm run dev`会先启动 Python/uv 预审服务，健康检查通过后再启动 Discord Bot，
两者共用根目录`.env`，本地不需要打开两个终端。生产环境使用`npm start`，同样由
一个启动器管理两个内部进程。

如需单独排查某一部分，仍可分别运行：

```bash
npm run dev:review
npm run dev:bot
```

`.env` 必填：

```dotenv
DISCORD_TOKEN=Discord Bot Token
DISCORD_CLIENT_ID=Discord Application ID
DISCORD_GUILD_ID=测试服务器ID
PRECHECK_SERVICE_URL=http://127.0.0.1:8000
ACTIVITY_CHANNEL_IDS=允许计入T001的频道ID,另一个频道ID
```

如果设置 `PRECHECK_SERVICE_TOKEN`，Bot 与 `review-service/.env` 必须使用同一个值。
`LLM_API_KEY` 不填时仍会执行 Python 规则，但所有依赖 AI 的结果都会明确标记为需要人工审核。
预审服务也支持 `OPENAI_API_KEY`、`OPENAI_BASE_URL` 和 `OPENAI_MODEL` 别名；
两组同时存在时优先使用 `LLM_*`。

建议开发阶段填写 `DISCORD_GUILD_ID`，Slash Commands 会立即在测试服务器更新。

## 2. Discord Developer Portal 设置

Bot 需要启用：

- Server Members Intent：后续邀请追踪使用
- Message Content Intent：T001 社区有效发言统计使用

建议 Bot 权限：

- View Channels
- Send Messages
- Embed Links
- Attach Files
- Read Message History
- Use Application Commands
- Manage Roles：只有启用自动等级身份时才需要

不要授予 Administrator。

## 3. 初始化任务

`npm run seed` 会创建 Season 2 和 23 个任务草稿，不会覆盖已经修改过的任务。

初始任务定义位于：

```text
src/data/season2-tasks.ts
```

所有任务默认为 `Draft`。运营确认任务说明后，通过：

```text
/task-admin status task_id:T018 status:Published
```

发布任务。

## 4. 用户命令

| 命令 | 作用 |
|---|---|
| `/season` | 当前赛季入口 |
| `/tasks` | 按类型和难度浏览任务 |
| `/task` | 查看任务详情、领取、提交 |
| `/submit` | 提交文字、链接和附件 |
| `/me` | 查看积分、等级和最近提交 |
| `/leaderboard` | 查看 Top 10 |

## 5. 管理命令

| 命令 | 作用 |
|---|---|
| `/task-admin import` | 上传 CSV/XLSX 任务表，按 Task ID 批量新增或更新 |
| `/task-admin edit` | 按 Task ID 修改标题、说明、积分、限制和审核方式 |
| `/task-admin clone` | 复制任务为新草稿 |
| `/task-admin status` | 发布、暂停、关闭或归档 |
| `/task-admin delete` | 按 Task ID 归档任务 |
| `/review next` | 获取下一个待审核提交 |
| `/review decide` | 通过、要求修改或驳回 |
| `/review create-batch` | 按 UTC 日期建立固定待审批次；不填日期则包含今天前全部未入批次提交 |
| `/review ai-preview` | 对指定批次中尚未完成 AI 初审的前 N 条执行增量预审 |
| `/review export` | 按 Batch ID 导出人工终审 Excel |
| `/review import` | 回传审核表并批量修改状态、发放积分 |
| `/review approve-batch` | 显式确认后直接通过整个审核批次 |
| `/activity-admin collect` | 补采指定频道某个完整 UTC 日的历史消息 |
| `/activity-admin precheck` | 对已采集消息执行规则与 AI 预审并生成审核记录 |
| `/activity-admin status` | 查看某个 UTC 日的采集与预审状态 |
| `/points-admin` | 通过新流水补分或扣分 |
| `/announce` | 以Bot身份向指定频道发布紫色社区更新Embed |
| `/export` | 导出CSV数据 |

已发布任务每次修改都会生成新版本。历史提交继续引用提交时的旧版本。

“删除任务”使用 `Archived`，不进行物理删除。

### 发布社区更新

运营人员可以使用 `/announce` 发布统一样式的社区更新。短公告可以直接填写
`content`；长公告建议上传 `.md` 或 `.txt` 文件到 `content_file`：

```text
/announce
  title: Season 2 Update
  content_file: announcement.md
  channel: #announcements
  link: https://your-community-portal.example
  image: 可选配图
  mention_everyone: False
```

Markdown 文件使用 `## Section title` 创建独立 Embed 区块，模板位于：

```text
templates/announcement-template.md
```

公告使用紫色侧边栏，并自动显示 `SpoonOS Community Update` 和发布时间。
`mention_everyone` 默认关闭；开启时 Bot 还需要 Discord 的 Mention Everyone 权限。

### 批量导入任务

任务表模板位于：

```text
templates/task-import-template.csv
```

使用：

```text
/task-admin import file:task-import-template.csv
```

支持 `.csv`、`.xlsx` 和 `.xls`。核心字段：

```text
task_id
title
type
difficulty
description
base_points
min_points
max_points
status
review_mode
claim_required
revision_allowed
per_day
per_week
per_month
per_season
requirements
submission_fields
ai_precheck
precheck_pipeline
review_criteria
required_evidence
disqualifiers
topic_definition
positive_examples
negative_examples
allowed_channel_ids
target_accounts
target_post_ids
opens_at
closes_at
```

- 新 Task ID：创建任务。
- 已存在的 Task ID：创建新版本并更新任务，不会重复创建。
- `requirements` 使用 `|` 分隔多条验收标准。
- 不填写 `status` 时，新任务默认为 `Draft`，已有任务保留当前状态。
- 面向用户展示的标题、说明和验收标准必须使用英文。
- 删除使用 `/task-admin delete task_id:T100`，实际执行可审计的 `Archived`，不物理删除历史数据。

## 6. 审核流程

```text
Submitted
→ Prechecked
→ UnderReview
→ Approved / RevisionRequired / Rejected
→ Appealed
```

快捷审核按钮支持：

- 通过：1.0
- 优秀：1.25
- 要求修改
- 驳回

需要 0.5 或 1.5 系数、详细审核理由时，使用 `/review decide`。

### 批量审核

第一步，建立固定审核批次。不填写日期时，纳入 UTC 今天以前全部尚未入批次的待审提交：

```text
/review create-batch
```

也可以选择最近3个完整UTC自然日：

```text
/review create-batch days:3
```

也可以指定UTC日期范围（结束日期必须早于UTC今天）：

```text
/review create-batch start_date:2026-08-01 end_date:2026-08-03
```

批次建立后成员固定，新提交不会进入旧批次。第二步，按 Batch ID 分段执行 AI Preview：

```text
/review ai-preview batch_id:review_xxx limit:5
```

`limit`默认是5，最少1、最多20。Bot只选择该批次内尚未成功完成 AI Preview 的前 N 条；再次执行同一命令会继续处理后续条目。AI服务临时不可用的记录不会被视为完成，后续可以重试。

第三步，导出固定批次进行最终人工审核：

```text
/review export batch_id:review_xxx
```

在导出的表格中只填写以下人工审核列：

- `review_decision`：`approve`、`revision` 或 `reject`
- `final_points`：通过时可直接填写最终整数积分
- `quality_coefficient`：也可按`0.5`、`1`、`1.25`、`1.5`填写，与`final_points`二选一
- `review_note`：审核说明；退回修改和驳回时必填

AI区域会给出`ai_suggested_decision`、`ai_suggested_coefficient`、
`ai_suggested_points`和`ai_reason`。这些列只供参考，Bot只读取上述人工审核列：
人工选择`approve`后才发分，`revision`和`reject`都不会写入积分流水。

完成后上传原文件：

```text
/review import file:completed-review.xlsx
```

Bot会验证`batch_id`和`submission_id`、批量更新状态，并只为通过项写入一次积分流水。重复上传同一文件不会重复发分。空白审核结果会被跳过。

### 每日活跃审核

T001 不再自动发分。Bot 只监听 `ACTIVITY_CHANNEL_IDS` 中的频道并保存原始消息；需要补采历史时执行：

```text
/activity-admin collect channel:#community-chat date:2026-08-12
/activity-admin precheck date:2026-08-12
/review create-batch start_date:2026-08-12 end_date:2026-08-12
/review ai-preview batch_id:review_xxx limit:5
/review export batch_id:review_xxx
```

Python 会先排除 GM/GN、过短内容、纯链接/表情和重复消息，再让 AI 按 T001 的
`topic_definition`、正反例和验收标准判断相关性与内容价值。预审只形成建议；运营在导出的审核表中批准后，积分才会进入流水。

确认整个批次均可通过时，可跳过表格回传：

```text
/review approve-batch
  batch_id:review_xxx
  point_mode:standard
  coefficient:1
  note:Batch evidence verified
  confirm:True
```

`point_mode:standard`按任务标准积分放行；`point_mode:ai_suggested`按 AI 建议积分放行，但仅当全部待审条目均已有 AI 通过结论和有效建议分数时才允许执行。可填写`task_id`，只通过对应Task ID；`confirm:True`为必需项，已完成审核的提交会跳过且不会重复发分。

导出文件中的`ai_score`、`ai_recommendation`、`ai_flags`、
`ai_missing_items`和`ai_review_questions`均为预审建议，最终决定始终以人工填写的审核结果为准。

## 7. AI预审

用户提交时默认只启用无需外部API的规则预审：

- 最低内容长度
- 必要证明材料
- 历史内容相似度
- Advanced/Bounty 复现追问

如需接入AI，在 `.env` 中填写：

```dotenv
AI_PRECHECK_WEBHOOK_URL=https://your-ai-service.example/precheck
AI_PRECHECK_WEBHOOK_TOKEN=optional-secret
```

然后为任务启用：

```text
/task-admin edit task_id:T018 ai_precheck:True review_mode:ai_then_human
```

AI不会在`/submit`时调用。运营在准备审核表时按需执行：

```text
/review export ai_precheck:True ai_limit:5
```

Webhook 协议见 [docs/AI_PRECHECK.md](docs/AI_PRECHECK.md)。

AI只提供预审建议，高价值任务始终由人工最终审核。

## 8. 前端门户数据接口

启用任务与排行榜公开只读接口：

```dotenv
PUBLIC_API_ENABLED=true
PUBLIC_API_PORT=8787
PORTAL_CORS_ORIGIN=https://your-community-portal.example
```

接口：

```text
GET /api/portal
GET /health
```

`/api/portal`返回已发布任务、Top 10成员、Discord名称、头像、积分、等级和下一等级信息。接口不返回提交证明、审核记录、钱包或其他敏感数据。

## 9. 数据导出

```text
/export type:users
/export type:tasks
/export type:submissions
/export type:points
/export type:content
```

其中：

- `users`：用户积分、提交、通过量和活跃天数
- `tasks`：各任务提交量、通过量和积分成本
- `submissions`：完整提交与审核记录
- `points`：积分审计流水
- `content`：Advanced、Bounty及优秀内容资产

## 10. 权限

可在 `.env` 配置多个 Discord Role ID，使用逗号分隔：

```dotenv
ADMIN_ROLE_IDS=role1,role2
REVIEWER_ROLE_IDS=role3
TASK_MANAGER_ROLE_IDS=role4
```

默认同时尊重 Discord 原生的 Manage Messages 和 Manage Guild 权限。

## 11. 验证

```bash
npm run typecheck
npm test
npm run build
```

测试覆盖任务版本、AI/规则预审、审核发分和重复审核保护。

## 12. 当前MVP边界

以下能力已经预留模块位置，但尚未完整接入第三方平台：

- X、Reddit真实关注和转发验证
- Discord邀请归因与7天留存检查
- 官方投票事件自动发分
- Discord等级身份自动同步
- Web管理后台
- 钱包收集和发奖状态

这些功能可以按插件逐步添加，不需要修改任务、提交、审核和积分核心。

## 13. 社区前端门户

前端项目位于：

```text
web/
```

包含：

- Tasks / Leaderboard切换
- 任务搜索、类型筛选和难度筛选
- Top 3展示和Top 10榜单
- Discord头像、用户名、积分和称号
- 当前等级与下一等级进度条
- 手机端自适应
- Discord/X链接分享预览图

本地连接Bot真实数据：

```dotenv
# Bot .env
PUBLIC_API_ENABLED=true
PUBLIC_API_PORT=8787
PORTAL_CORS_ORIGIN=http://localhost:3000
COMMUNITY_PORTAL_URL=http://localhost:3000

# web/.env
COMMUNITY_API_URL=http://localhost:8787
NEXT_PUBLIC_DISCORD_CONTRIBUTE_URL=https://discord.com/channels/1357234847567052800/1470983743090200729
```

### 本地联调

连接Discord并同时开放只读API：

```bash
npm run dev:local
```

如果只想验证数据库、Tasks和Leaderboard，不连接Discord：

```bash
npm run dev:api
```

然后在第二个终端启动前端：

```bash
cd web
npm run dev:local
```

可用以下地址检查数据链路：

```text
http://127.0.0.1:8787/health
http://127.0.0.1:8787/api/tasks
http://127.0.0.1:8787/api/leaderboard
http://127.0.0.1:8787/api/portal
```

`dev:api`模式不会连接Discord，因此用户名会显示为安全的Member占位名称，头像暂时为空；使用`dev:local`连接Bot后会返回真实Discord名称和头像。

配置`COMMUNITY_PORTAL_URL`后，普通成员使用`/tasks`会直接收到Tasks /
Leaderboard门户链接。管理员仍可通过`/tasks`查看包含Draft状态的内部任务列表。

前端不直接打开SQLite文件，而是由Bot的只读`/api/portal`接口读取同一数据库，
只返回已发布任务和公开榜单字段。生产环境中，`COMMUNITY_API_URL`必须填写为前端服务器可访问的Bot API地址；如果API不可用，页面会明确显示数据暂不可用，不再伪装成实时演示数据。
