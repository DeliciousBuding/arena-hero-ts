/** Wire parsing and stable serialization for the public v0.1 protocol.
 *
 * 对应上游 _protocol.py：
 * - WS 流消息 envelope：{type:"tick",data:N} / {type:"state",data:PlayerState} /
 *   {type:"received",data:Received}，按 type 判别
 * - encodePlan 与上游逐字节兼容：sort_keys + exclude_none + 紧凑 JSON
 */

import type { Accepted, CommandPlan } from "./actions.ts";
import { APIError, ProtocolError } from "./errors.ts";
import { checkReceivedConsistency, parsePlayerState, type PlayerState, type Received, type Tick } from "./types.ts";

interface TickEnvelope {
  type: "tick";
  data: number;
}
interface StateEnvelope {
  type: "state";
  data: unknown;
}
interface ReceivedEnvelope {
  type: "received";
  data: unknown;
}
type StreamEnvelope = TickEnvelope | StateEnvelope | ReceivedEnvelope;

function parseEnvelope(raw: string): StreamEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ProtocolError("invalid Arena Hero WebSocket message");
  }
  if (typeof parsed !== "object" || parsed === null || typeof (parsed as { type?: unknown }).type !== "string") {
    throw new ProtocolError("invalid Arena Hero WebSocket message");
  }
  const envelope = parsed as Record<string, unknown>;
  if (envelope.type === "tick") {
    if (typeof envelope.data !== "number" || !Number.isInteger(envelope.data) || envelope.data < 1) {
      throw new ProtocolError("invalid tick message");
    }
    return { type: "tick", data: envelope.data };
  }
  if (envelope.type === "state") {
    return { type: "state", data: envelope.data };
  }
  if (envelope.type === "received") {
    return { type: "received", data: envelope.data };
  }
  throw new ProtocolError(`unknown message type: ${envelope.type}`);
}

/** Parse one server WebSocket text message. */
export function parseStreamMessage(raw: string | Uint8Array): Tick | PlayerState | Received {
  if (raw instanceof Uint8Array) {
    throw new ProtocolError("the server sent a binary WebSocket message");
  }
  const envelope = parseEnvelope(raw);
  if (envelope.type === "tick") {
    return { tick: envelope.data } satisfies Tick;
  }
  if (envelope.type === "state") {
    return parsePlayerState(envelope.data);
  }
  const received = envelope.data as Partial<Received>;
  if (typeof received?.tick !== "number" || typeof received?.received_at !== "string" || received?.plan == null) {
    throw new ProtocolError("invalid received message");
  }
  const rec = received as unknown as Received;
  checkReceivedConsistency(rec);
  return rec;
}

/** 递归归一化：删 null/undefined 字段、对象键排序——对应上游 sort_keys + exclude_none。 */
function normalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalize);
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== null && v !== undefined)
      .map(([k, v]) => [k, normalize(v)] as const)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(entries);
  }
  return value;
}

/** Serialize a complete plan into stable, compact UTF-8 JSON string. */
export function encodePlan(plan: CommandPlan): string {
  const data = normalize(plan);
  return JSON.stringify(data);
}

/** Parse a successful command acknowledgement. */
export function parseAccepted(raw: Uint8Array): Accepted {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    throw new ProtocolError("invalid command acknowledgement");
  }
  const a = parsed as Partial<Accepted>;
  if (
    a?.accepted !== true ||
    typeof a.tick !== "number" ||
    !Number.isInteger(a.tick) ||
    a.tick < 1 ||
    typeof a.received_at !== "string" ||
    (a.source !== "AGENT" && a.source !== "MANUAL")
  ) {
    throw new ProtocolError("invalid command acknowledgement");
  }
  return a as Accepted;
}

/** Build a structured API error without exposing request credentials. */
export function apiError(statusCode: number, raw: Uint8Array): APIError {
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    payload = {};
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    payload = {};
  }
  const p = payload as Record<string, unknown>;
  const error = typeof p.error === "string" ? p.error : "HTTP_ERROR";
  const message = typeof p.message === "string" ? p.message : null;
  const details: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(p)) {
    if (key !== "error" && key !== "message") {
      details[key] = value;
    }
  }
  return new APIError(statusCode, error, message, details);
}
