---
id: 对话问候-skill
name: 对话问候 Skill
model: doubao-seed-2-0-mini-260215
temperature: 0.3
maxTokens: 800
enabled: false
requiredTools: []
body: # 对话问候 Skill

用于在对话开始时或用户主动打招呼时，生成自然、友好的问候语，并识别用户意图以开启有效交流。

## 输入

| 字段 | 类型 | 描述 |
|------|------|------|
| `user_message` | string | 用户发送的消息文本 |
| `conversation_history` | array | 最近5条对话历史（可选），每条包含 `role` 和 `content` |
| `user_name` | string | 用户名称（可选），用于个性化问候 |

## 输出 JSON

```json
{
  "type": "object",
  "properties": {
    "greeting_text": {
      "type": "string",
      "description": "生成的问候语文本"
    },
    "intent": {
      "type": "string",
      "enum": ["greeting", "question", "complaint", "chitchat", "other"],
      "description": "识别出的用户意图类别"
    },
    "suggested_action": {
      "type": "string",
      "description": "建议的下一步动作，如'respond_greeting', 'answer_question', 'transfer_to_human'"
    }
  },
  "required": ["greeting_text", "intent", "suggested_action"]
}
```

**示例输出：**
```json
{
  "greeting_text": "你好！很高兴见到你，有什么我可以帮你的吗？",
  "intent": "greeting",
  "suggested_action": "respond_greeting"
}
```

## 规则

1. 如果用户消息中包含“你好”、“嗨”、“早上好”等常见问候词，则 `intent` 必须设为 `greeting`，并生成对应的问候语。
2. 问候语必须根据 `user_name`（如果提供）进行个性化，例如“王先生，你好！”；若未提供，则使用通用称呼。
3. 如果用户消息同时包含问候和具体问题（如“你好，请问退款怎么操作？”），则 `intent` 设为 `question`，问候语中应自然衔接问题引导。
4. 生成的 `greeting_text` 长度不得超过 50 个字符，且语气需友好、正式，避免使用表情符号。
5. 当 `conversation_history` 为空或仅包含系统消息时，必须生成问候语；否则，仅在用户明确打招呼时生成。
6. `suggested_action` 必须与 `intent` 严格对应：`greeting` 对应 `respond_greeting`，`question` 对应 `answer_question`，`complaint` 对应 `transfer_to_human`，`chitchat` 对应 `respond_greeting`，`other` 对应 `respond_greeting`。
description: 用于在对话开始时或用户主动打招呼时，生成自然、友好的问候语，并识别用户意图以开启有效交流。
---

# 对话问候 Skill

用于在对话开始时或用户主动打招呼时，生成自然、友好的问候语，并识别用户意图以开启有效交流。

## 输入

| 字段 | 类型 | 描述 |
|------|------|------|
| `user_message` | string | 用户发送的消息文本 |
| `conversation_history` | array | 最近5条对话历史（可选），每条包含 `role` 和 `content` |
| `user_name` | string | 用户名称（可选），用于个性化问候 |

## 输出 JSON

```json
{
  "type": "object",
  "properties": {
    "greeting_text": {
      "type": "string",
      "description": "生成的问候语文本"
    },
    "intent": {
      "type": "string",
      "enum": ["greeting", "question", "complaint", "chitchat", "other"],
      "description": "识别出的用户意图类别"
    },
    "suggested_action": {
      "type": "string",
      "description": "建议的下一步动作，如'respond_greeting', 'answer_question', 'transfer_to_human'"
    }
  },
  "required": ["greeting_text", "intent", "suggested_action"]
}
```

**示例输出：**
```json
{
  "greeting_text": "你好！很高兴见到你，有什么我可以帮你的吗？",
  "intent": "greeting",
  "suggested_action": "respond_greeting"
}
```

## 规则

1. 如果用户消息中包含“你好”、“嗨”、“早上好”等常见问候词，则 `intent` 必须设为 `greeting`，并生成对应的问候语。
2. 问候语必须根据 `user_name`（如果提供）进行个性化，例如“王先生，你好！”；若未提供，则使用通用称呼。
3. 如果用户消息同时包含问候和具体问题（如“你好，请问退款怎么操作？”），则 `intent` 设为 `question`，问候语中应自然衔接问题引导。
4. 生成的 `greeting_text` 长度不得超过 50 个字符，且语气需友好、正式，避免使用表情符号。
5. 当 `conversation_history` 为空或仅包含系统消息时，必须生成问候语；否则，仅在用户明确打招呼时生成。
6. `suggested_action` 必须与 `intent` 严格对应：`greeting` 对应 `respond_greeting`，`question` 对应 `answer_question`，`complaint` 对应 `transfer_to_human`，`chitchat` 对应 `respond_greeting`，`other` 对应 `respond_greeting`。