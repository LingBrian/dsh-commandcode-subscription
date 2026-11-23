/** Isolated pi-ai transport for Command Code's private, NDJSON /alpha/generate API.
 * The host owns credentials and persistence; this module never reads environment variables.
 */
import { calculateCost, createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { currentLocale, localize, localizedError, safeErrorMessage } from './locale.js';

const ORIGIN = "https://api.commandcode.ai";
const GENERATE = `${ORIGIN}/alpha/generate`;
const CATALOG = `${ORIGIN}/provider/v1/models`;
const MAX_LINE_BYTES = 1024 * 1024;
const MAX_BODY_BYTES = 32 * 1024 * 1024;
const VERSION = "0.52.1"; // Gateway may change its CLI-version requirement.
const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
// Capabilities corroborated by the native Command Code Pi provider. The public
// catalog alone is not proof that every listed model accepts images.
const IMAGE_MODEL_IDS = new Set([
  "deepseek/deepseek-v4-flash-vision-exp",
  "moonshotai/Kimi-K3",
  "moonshotai/Kimi-K2.7-Code",
  "moonshotai/Kimi-K2.7-Code-Highspeed",
  "moonshotai/Kimi-K2.6",
  "moonshotai/Kimi-K2.5",
  "MiniMaxAI/MiniMax-M3",
  "Qwen/Qwen3.8-27B",
  "stepfun/Step-3.7-Flash",
  "thinkingmachines/inkling",
]);
const FALLBACK_MODELS = { data: [
  { id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash (Command Code)", context_length: 1000000 },
] }; // Catalog snapshot, not an availability or entitlement guarantee.

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function nonnegative(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}
function requiredString(value, label) {
  if (typeof value !== "string" || !value) throw new Error(`Invalid Command Code ${label}`);
  return value;
}
function toolObject(value) {
  if (!object(value)) throw new Error("Command Code tool arguments must be a JSON object");
  return value;
}
function toText(value) {
  return typeof value === "string" ? value : "";
}

/** The public catalog is not an entitlement check; no unverified capability/price claims. */
export function parseCommandCodeModels(payload) {
  if (!object(payload) || !Array.isArray(payload.data)) throw new Error("Invalid Command Code model catalog");
  const seen = new Set();
  return payload.data.flatMap((row) => {
    if (!object(row) || typeof row.id !== "string" || !row.id || seen.has(row.id)) return [];
    if (!Number.isSafeInteger(row.context_length) || row.context_length <= 0) return [];
    seen.add(row.id);
    return [{ id: row.id, name: typeof row.name === "string" ? row.name : row.id,
      api: "commandcode-generate", provider: "commandcode-go", baseUrl: ORIGIN,
      reasoning: false, input: IMAGE_MODEL_IDS.has(row.id) ? ["text", "image"] : ["text"], contextWindow: row.context_length,
      maxTokens: Math.min(row.context_length, 131072), cost: { ...ZERO_COST } }];
  });
}

/** Convert pi-ai history into the upstream ModelMessage[] wire format. */
export function convertCommandCodeMessages(messages) {
  if (!Array.isArray(messages)) throw new Error("Invalid conversation messages");
  const names = new Map();
  const result = [];
  for (const message of messages) {
    if (message.role === "system") {
      // DSH projects developer history as pi-ai system messages. The native
      // generate endpoint accepts instructions in params.system, not history.
      continue;
    } else if (message.role === "user") {
      const parts = typeof message.content === "string" ? [{ type: "text", text: message.content }] :
        (message.content ?? []).map((part) => {
          if (part.type === "text") return { type: "text", text: part.text };
          if (part.type === "image") return { type: "image",
            image: `data:${part.mimeType};base64,${part.data}`, mediaType: part.mimeType };
          throw new Error(`Unsupported user content: ${part.type}`);
        });
      if (parts.length) result.push({ role: "user", content: parts });
    } else if (message.role === "assistant") {
      const parts = [];
      for (const part of message.content ?? []) {
        if (part.type === "text") parts.push({ type: "text", text: part.text });
        else if (part.type === "toolCall") {
          names.set(part.id, part.name);
          parts.push({ type: "tool-call", toolCallId: part.id, toolName: part.name,
            input: toolObject(part.arguments) });
        } else if (part.type !== "thinking") throw new Error(`Unsupported assistant content: ${part.type}`);
      }
      if (parts.length) result.push({ role: "assistant", content: parts });
    } else if (message.role === "toolResult") {
      const value = (message.content ?? []).map((part) => {
        if (part.type !== "text") throw new Error("Non-text tool results are not supported");
        return part.text;
      }).join("");
      const part = { type: "tool-result", toolCallId: message.toolCallId,
        toolName: names.get(message.toolCallId) ?? message.toolName,
        output: { type: message.isError ? "error-text" : "text", value } };
      requiredString(part.toolName, "tool result name");
      const previous = result.at(-1);
      if (previous?.role === "tool") previous.content.push(part);
      else result.push({ role: "tool", content: [part] });
    } else throw new Error(`Unsupported message role: ${message.role}`);
  }
  return result;
}

function commandCodeSystemPrompt(context) {
  const parts = [];
  if (context.systemPrompt) parts.push(context.systemPrompt);
  for (const message of context.messages) {
    if (message.role !== "system") continue;
    const content = typeof message.content === "string" ? message.content :
      (message.content ?? []).filter(part => part.type === "text").map(part => part.text).join("\n");
    if (content) parts.push(content);
  }
  return parts.join("\n\n");
}

export function convertCommandCodeUsage(raw, model) {
  const usage = object(raw) ? raw : {};
  const read = nonnegative(usage.cachedInputTokens ?? usage.inputTokenDetails?.cacheReadTokens ?? usage.raw?.prompt_cache_hit_tokens);
  const totalInput = nonnegative(usage.inputTokens ?? usage.input_tokens);
  const result = { input: Math.max(0, totalInput - read), output: nonnegative(usage.outputTokens ?? usage.output_tokens),
    cacheRead: read, cacheWrite: 0, totalTokens: totalInput + nonnegative(usage.outputTokens ?? usage.output_tokens),
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
  if (model?.cost) calculateCost(model, result);
  return result;
}

/** Bounded, incremental UTF-8 NDJSON reader; malformed lines and truncated streams fail closed. */
export async function* readCommandCodeLines(body, signal, locale) {
  const reader = body.getReader();
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener("abort", abort, { once: true });
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  let bytes = 0;
  let line = 0;
  const parse = (text) => {
    if (!text.trim()) return null;
    line++;
    try {
      const event = JSON.parse(text);
      if (!object(event) || typeof event.type !== "string") throw new Error("Invalid event");
      return event;
    } catch { throw localizedError(locale, 'malformedLine', { line }); }
  };
  try {
    while (true) {
      if (signal?.aborted) throw localizedError(locale, 'requestAborted');
      let chunk;
      try { chunk = await reader.read(); }
      catch {
        if (signal?.aborted) throw localizedError(locale, 'requestAborted');
        throw localizedError(locale, 'transportFailed');
      }
      const { done, value } = chunk;
      if (signal?.aborted) throw localizedError(locale, 'requestAborted');
      if (done) break;
      if (!(value instanceof Uint8Array)) throw localizedError(locale, 'invalidChunk');
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) throw localizedError(locale, 'bodyLimit');
      buffer += decoder.decode(value, { stream: true });
      let newline;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const segment = buffer.slice(0, newline);
        if (Buffer.byteLength(segment, "utf8") > MAX_LINE_BYTES) throw localizedError(locale, 'lineLimit');
        buffer = buffer.slice(newline + 1);
        const event = parse(segment);
        if (event) yield event;
      }
      if (Buffer.byteLength(buffer, "utf8") > MAX_LINE_BYTES) throw localizedError(locale, 'lineLimit');
    }
    buffer += decoder.decode();
    if (buffer) {
      if (Buffer.byteLength(buffer, "utf8") > MAX_LINE_BYTES) throw localizedError(locale, 'lineLimit');
      const event = parse(buffer);
      if (event) yield event;
    }
  } finally {
    signal?.removeEventListener("abort", abort);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function makeOutput(model) {
  return { role: "assistant", content: [], api: model.api, provider: model.provider,
    model: model.id, usage: convertCommandCodeUsage(null, model), stopReason: "stop", timestamp: Date.now() };
}
function reasonFor(value, hasTools) {
  if (value === "length") return "length";
  if (value === "tool-calls" || value === "tool_calls" || value === "tool_use" || hasTools) return "toolUse";
  if (value === "stop" || value === undefined) return "stop";
  return "stop";
}

/** Stateful translation; no tool call can finish with missing/malformed/non-object JSON. */
export function applyCommandCodeEvent(state, event, push) {
  const { output, blocks, locale } = state;
  const id = event.id ?? event.toolCallId;
  const emit = (type, extra = {}) => push({ type, ...extra, partial: output });
  if (state.terminal) return;
  if (event.type === "error") throw localizedError(locale, 'streamError');
  if (event.type === "start" || event.type === "start-step") return;
  if (["text-start", "reasoning-start", "tool-input-start"].includes(event.type)) {
    requiredString(id, "event id");
    if (blocks.has(id) && !blocks.get(id).ended) throw new Error("Duplicate Command Code event id");
    const kind = event.type === "text-start" ? "text" : event.type === "reasoning-start" ? "thinking" : "toolCall";
    const block = kind === "text" ? { type: "text", text: "" } : kind === "thinking" ?
      { type: "thinking", thinking: "" } : { type: "toolCall", id, name: requiredString(event.toolName ?? event.name, "tool name"), arguments: {} };
    const index = output.content.push(block) - 1;
    blocks.set(id, { index, kind, json: "", ended: false });
    emit(kind === "toolCall" ? "toolcall_start" : `${kind}_start`, { contentIndex: index });
    return;
  }
  if (event.type === "tool-call" && !blocks.has(id)) {
    applyCommandCodeEvent(state, { type: "tool-input-start", id, toolName: event.toolName ?? event.name }, push);
  }
  if (["text-delta", "reasoning-delta", "tool-input-delta", "text-end", "reasoning-end", "tool-input-end", "tool-call"].includes(event.type)) {
    requiredString(id, "event id");
    const record = blocks.get(id);
    const expected = event.type.startsWith("text-") ? "text" : event.type.startsWith("reasoning-") ? "thinking" : "toolCall";
    // The gateway may send tool-call after tool-input-end for the same call.
    if (record?.ended && (event.type === "tool-call" || event.type.endsWith("-end"))) return;
    if (!record || record.ended || record.kind !== expected) throw new Error("Invalid Command Code event sequence");
    const block = output.content[record.index];
    if (event.type.endsWith("-delta")) {
      const delta = expected === "toolCall" ? event.delta : event.text;
      if (typeof delta !== "string") throw new Error("Invalid Command Code event delta");
      if (expected === "toolCall") {
        record.json += delta;
        if (Buffer.byteLength(record.json, "utf8") > MAX_LINE_BYTES) throw new Error("Tool input exceeds limit");
      } else block[expected === "thinking" ? "thinking" : "text"] += delta;
      emit(expected === "toolCall" ? "toolcall_delta" : `${expected}_delta`, { contentIndex: record.index, delta });
    } else {
      if (expected === "toolCall") {
        const complete = event.input ?? event.args;
        if (complete === undefined && !record.json) throw new Error("Missing Command Code tool arguments");
        let parsed;
        try { parsed = complete === undefined ? JSON.parse(record.json) : complete; }
        catch { throw new Error("Malformed Command Code tool arguments"); }
        block.arguments = toolObject(parsed);
        emit("toolcall_end", { contentIndex: record.index, toolCall: { ...block } });
      } else emit(`${expected}_end`, { contentIndex: record.index,
        content: block[expected === "thinking" ? "thinking" : "text"] });
      record.ended = true;
    }
    return;
  }
  if (event.type === "finish-step" || event.type === "finish") {
    for (const record of blocks.values()) {
      if (record.ended) continue;
      if (record.kind === "toolCall") throw new Error("Command Code stream has unfinished tool input");
      const block = output.content[record.index];
      emit(`${record.kind}_end`, { contentIndex: record.index,
        content: block[record.kind === "thinking" ? "thinking" : "text"] });
      record.ended = true;
    }
    state.sawTerminal = true;
    if (event.type === "finish") state.terminal = true;
    if (event.usage ?? event.totalUsage) output.usage = convertCommandCodeUsage(event.usage ?? event.totalUsage, state.model);
    output.stopReason = reasonFor(event.finishReason ?? event.rawFinishReason, output.content.some((item) => item.type === "toolCall"));
  }
  // Ignore unknown metadata events; they must not satisfy the terminal condition.
}

export function createCommandCodeProvider({ fetch: fetchImpl = globalThis.fetch, resolveModels } = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetch must be a function");
  let models = parseCommandCodeModels(FALLBACK_MODELS);
  async function refreshModels({ signal } = {}) {
    const deadline = AbortSignal.timeout(3000);
    const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
    const updated = resolveModels
      ? await resolveModels({ signal: combined, fetch: fetchImpl, parseCommandCodeModels })
      : await (async () => {
        const response = await fetchImpl(CATALOG, { headers: { Accept: "application/json" }, signal: combined });
        if (!response.ok) throw new Error(`Command Code model catalog HTTP ${response.status}`);
        return parseCommandCodeModels(await response.json());
      })();
    if (!Array.isArray(updated) || !updated.length) throw new Error("Command Code model catalog is empty");
    if (!combined.aborted) models = updated;
    return models;
  }
  // DSH and pi-ai enumerate the provider synchronously; background refresh updates this snapshot.
  function getModels() { return models; }
  function streamSimple(model, context, options = {}) {
    const locale = options.locale ?? currentLocale();
    const stream = createAssistantMessageEventStream();
    const output = makeOutput(model);
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (options.signal?.aborted) abort();
    else options.signal?.addEventListener("abort", abort, { once: true });
    (async () => {
      let stage = 'requestPreparation';
      try {
        if (controller.signal.aborted) throw localizedError(locale, 'requestAborted');
        if (typeof options.apiKey !== 'string' || !options.apiKey || /[\r\n]/.test(options.apiKey))
          throw localizedError(locale, 'invalidApiKey');
        const key = options.apiKey;
        const payload = { config: { workingDir: "/", date: new Date().toISOString().slice(0, 10),
          environment: "production", structure: [], isGitRepo: false, currentBranch: "",
          mainBranch: "", gitStatus: "", recentCommits: [] },
          memory: "", taste: null, skills: null, permissionMode: "standard",
          params: { model: requiredString(model.id, "model"), system: commandCodeSystemPrompt(context),
            messages: convertCommandCodeMessages(context.messages),
            tools: (context.tools ?? []).map((tool) => ({ name: tool.name, description: tool.description,
              input_schema: tool.parameters ?? { type: "object", properties: {} } })), max_tokens: options.maxTokens ?? model.maxTokens ?? 8192,
            ...(options.temperature === undefined ? {} : { temperature: options.temperature }), stream: true } };
        stream.push({ type: "start", partial: output });
        stage = 'upstreamRequest';
        let response;
        try {
          response = await fetchImpl(GENERATE, { method: "POST", redirect: "error", signal: controller.signal,
            headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json",
              Accept: "application/x-ndjson", "x-cli-environment": "production",
              "x-command-code-version": VERSION, "x-session-id": options.sessionId ?? crypto.randomUUID() },
            body: JSON.stringify(payload) });
        } catch {
          if (controller.signal.aborted) throw localizedError(locale, 'requestAborted');
          throw localizedError(locale, 'transportFailed');
        }
        if (!response.ok) {
          void response.body?.cancel().catch(() => {});
          throw localizedError(locale, 'httpError', { status: Number.isInteger(response.status) && response.status >= 100 && response.status <= 599 ? response.status : 'error' });
        }
        if (!response.body) throw localizedError(locale, 'emptyResponse');
        stage = 'responseStream';
        const state = { model, output, blocks: new Map(), terminal: false, locale };
        for await (const event of readCommandCodeLines(response.body, controller.signal, locale)) {
          if (controller.signal.aborted) throw localizedError(locale, 'requestAborted');
          applyCommandCodeEvent(state, event, (item) => stream.push(item));
        }
        if (!state.sawTerminal) throw localizedError(locale, 'streamTruncated');
        if (controller.signal.aborted) throw localizedError(locale, 'requestAborted');
        stream.push({ type: "done", reason: output.stopReason, message: output });
      } catch (error) {
        output.stopReason = controller.signal.aborted ? "aborted" : "error";
        // Never reflect upstream response/error text (or an exception's cause) into host events.
        // Only errors minted by this module carry a trusted localization key.
        output.errorMessage = controller.signal.aborted ? localize(locale, 'requestAborted') : safeErrorMessage(locale, error, stage);
        stream.push({ type: "error", reason: output.stopReason, error: output });
      } finally {
        controller.abort();
        options.signal?.removeEventListener("abort", abort);
        stream.end();
      }
    })();
    return stream;
  }
  return { id: "commandcode-go", name: "Command Code", baseUrl: ORIGIN, api: "commandcode-generate", getModels, refreshModels, streamSimple };
}
