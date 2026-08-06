# AI Precheck Webhook

AI预审通过Webhook接入，Bot不绑定特定模型或厂商。普通用户提交时只运行
本地规则；运营先用`/review create-batch`建立固定批次，再执行
`/review ai-preview batch_id:review_xxx limit:5`时才会批量调用此接口。

## 请求

```http
POST /precheck
Authorization: Bearer <optional token>
Content-Type: application/json
```

```json
{
  "version": "1",
  "task": {
    "id": "T018",
    "title": "提交产品体验反馈报告",
    "difficulty": "Advanced",
    "requirements": [
      "包含真实使用场景",
      "提供截图或录屏"
    ]
  },
  "submission": {
    "id": "sub_xxx",
    "summary": "用户提交内容",
    "proofUrl": "https://example.com/proof",
    "attachmentUrl": "https://cdn.discordapp.com/...",
    "structuredData": {}
  },
  "recentSubmissionTexts": []
}
```

## 响应

```json
{
  "score": 78,
  "recommendation": "review",
  "flags": [
    "generic_content_risk"
  ],
  "missingItems": [
    "缺少真实操作结果"
  ],
  "reviewQuestions": [
    "请说明测试环境和关键操作步骤。"
  ]
}
```

`recommendation` 可取：

- `pass`
- `review`
- `revision`

## 原则

- AI不得直接发放高价值任务积分。
- AI不得根据所谓“AI生成概率”自动拒绝。
- 预审应检查完整性、相关性、证据、可复现性和历史相似度。
- 返回结果必须结构化，便于更换模型和保留审计记录。
- Webhook异常时自动回退人工审核。
