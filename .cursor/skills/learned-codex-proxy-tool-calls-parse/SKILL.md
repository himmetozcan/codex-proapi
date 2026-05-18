---
name: learned-codex-proxy-tool-calls-parse
description: Parse ChatGPT Codex backend SSE for tool_calls (content_part.added, output_item.done, function_call_arguments.delta/done) and return OpenAI Chat Completions format. Use when implementing or fixing tool call parsing in a Codex reverse proxy (OpenAI-compatible /v1/chat/completions) that consumes Responses API-style SSE.
---

# Parse backend SSE tool_calls to OpenAI format

Use this skill when the proxy must parse server-sent events for function/tool calls and return them in OpenAI `message.tool_calls` format (non-stream and stream).

## 1. Non-stream: collect text and tool_calls in parseStreamToText

- Read SSE line by line; parse `data: {...}` JSON. Skip `[DONE]`.
- Collect `response.output_text.delta` into `fullText`.
- Maintain `pendingByItemId[item_id]` with `{ id, name, arguments }` for in-progress calls.
- On `response.content_part.added`: if `part.type` is function_call-like (`function_call`, `function`, `tool_use`, `tool_call`), set `pendingByItemId[event.item_id] = { id, name, arguments: '' }`. Use helpers to get name/id from part (see step 4).
- On `response.output_item.done`: if `event.item.content` is an array, scan for parts with function_call-like type; push `{ id, name }` into `itemIdToCallInfos[event.item.id]`. Backfill pending for that item_id if needed. If a tool call was already pushed with empty name (e.g. function_call_arguments.done came first), backfill the last tool call’s name and id from the first info in `itemIdToCallInfos[itemId]`.
- On `response.function_call_arguments.delta`: append `event.delta` to `pendingByItemId[event.item_id].arguments`; if no pending exists, create one with `id: call_${itemId}`, `name: ''`, `arguments: ''`.
- On `response.function_call_arguments.done`: build one tool call from pending and/or `itemIdToCallInfos[item_id]` queue and event; push to `toolCalls`; delete `pendingByItemId[item_id]`.
- Return `{ text: fullText, tool_calls: toolCalls }` where each element is `{ id, type: 'function', function: { name, arguments } }`.

## 2. Non-stream response in handleChatCompletions

- Call `parseStreamToText(backendRes.body)` and destructure `{ text, tool_calls }`.
- If `tool_calls.length > 0`: set `message.tool_calls = tool_calls`, `message.content = text || null`, `finish_reason: 'tool_calls'`. Otherwise `message.content = text`, `finish_reason: 'stop'`.

## 3. Stream: same collection in pipeStreamToOpenAI

- Reuse the same event handling (content_part.added, output_item.done, function_call_arguments.delta/done) and the same `pendingByItemId`, `itemIdToCallInfos`, and `toolCalls` array.
- When stream ends (e.g. `[DONE]` or reader done): if `toolCalls.length > 0`, send one chunk with `delta: { content: null, tool_calls: toolCalls.map((tc, idx) => ({ index: idx, id: tc.id, type: 'function', function: { name: tc.function.name, arguments: tc.function.arguments } })) }` and `finish_reason: 'tool_calls'`. Then send final chunk with `finish_reason: 'stop'` and `data: [DONE]`.

## 4. Helpers for backend field variation

- `getFunctionName(obj)`: return `obj.name || obj.function_name || obj.tool_name || obj.function?.name || obj.call_name || ''`.
- `getFunctionCallId(obj, fallback)`: return `obj.id || obj.call_id || obj.function?.id || fallback`.
- `isFunctionCallPart(part)`: return true if `part.type` is `function_call`, `function`, `tool_use`, or `tool_call`.
- Use these when reading from `event.part`, `event.item.content[]`, and `event` in function_call_arguments.done (e.g. name from `getFunctionName(event)` as fallback).

## 5. Request tools fallback when backend never sends name

- If the backend never includes the tool name in any event, infer it from the request: `getToolNameFromRequest(tools, index)` returns `tools[index].function.name` or, when `tools.length === 1`, `tools[0].function.name`. Call it when the resolved name is still empty before pushing a tool call.
- Pass request tools into the parser: `parseStreamToText(stream, { tools: openaiReq.tools })` and `pipeStreamToOpenAI(backendStream, res, model, id, { tools: openaiReq.tools })`. In both branches, when building the tool call in function_call_arguments.done, set `if (!name && requestTools) name = getToolNameFromRequest(requestTools, toolCalls.length)`.

## 6. Optional SSE dump for debugging

- If `process.env.CODEX_DUMP_SSE === '1'` or `'true'`, on each `response.content_part.added`, `response.output_item.done`, and `response.function_call_arguments.done`, append one JSON line to `scripts/dump_sse.jsonl` (omit large `response` if present). Run the server with `CODEX_DUMP_SSE=1`, trigger a tool call, then inspect the file to see exact backend field names and fix helpers if needed.
