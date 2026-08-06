# Architecture

## 模块边界

```text
Discord Adapter
  ├─ Commands
  ├─ Buttons / Modals
  └─ Notifications

Application Services
  ├─ TaskService
  ├─ SubmissionService
  ├─ PointsService
  ├─ ActivityService
  ├─ AppealService
  └─ ExportService

Plugins
  ├─ RuleBasedPrecheck
  └─ WebhookAiPrecheck

Persistence
  ├─ TaskRepository
  ├─ SubmissionRepository
  ├─ PointsRepository
  └─ SQLite
```

Discord 代码不直接修改数据库，统一通过应用服务操作。

## 核心数据

### Task + TaskVersion

`tasks` 保存当前状态和版本号，`task_versions` 保存每个历史配置。

任务积分或规则修改后：

- 新提交使用新版本
- 旧提交仍引用旧版本
- 已发积分不变
- 修改动作进入审计日志

### Submission

提交保存：

- 用户与任务版本
- 说明、链接和附件
- 预审结果
- 审核状态
- 审核员与理由
- 质量系数和最终积分

### PointLedger

每次发分、补分和扣分都应新增流水。不要直接修改用户总积分。

排行榜使用积分流水实时聚合。

## 插件扩展

插件通过 `PrecheckPlugin` 接口注册：

```ts
interface PrecheckPlugin {
  id: string;
  supports(task: TaskRecord): boolean;
  run(context: PluginContext): Promise<PrecheckResult>;
}
```

新插件只需：

1. 实现接口。
2. 在启动时注册。
3. 将插件ID添加到任务配置。

未来可增加：

- `x_post_validator`
- `reddit_validator`
- `invite_retention_validator`
- `bug_duplicate_detector`
- `faq_accuracy_precheck`
- `product_feedback_precheck`

## 数据库升级建议

SQLite适合单服务器MVP。

出现以下情况时迁移至PostgreSQL：

- Bot多实例运行
- 同时运行Web管理后台和后台Worker
- 审核人员明显增加
- 需要高可用或云端数据分析

仓储层已经与Discord交互分离，迁移时主要替换`src/db`。
