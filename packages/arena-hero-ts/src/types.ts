/** Immutable models for Arena Hero state and WebSocket messages.
 *
 * 数据模型为纯只读接口；网络边界解析后经窄校验（见 protocol.ts），
 * 校验失败抛 ProtocolError——对应上游 pydantic 的防御性校验。
 */

import { ProtocolError } from "./errors.ts";
import type {
  BeaconStatus,
  CommandSource,
  CoreState,
  Direction,
  HarvestSource,
  PlayerStatus,
  UnitType,
} from "./enums.ts";
import { BeaconStatus as BS, CommandSource as CS, CoreState as CSt, PlayerStatus as PS, UnitType as UT } from "./enums.ts";
import type { Position } from "./geometry.ts";
import type { CommandPlan } from "./actions.ts";

/** The public Beacon position and its visibility-limited status. */
export interface ChampionBeacon {
  position: Position;
  status: BeaconStatus | null;
  carrier_id: string | null;
}

/** A batch of visible UUID-less terrain cells. */
export interface TerrainView {
  kind: "OBSTACLE" | "RESOURCE";
  positions: readonly Position[];
}

/** A controlled or visible Core. */
export interface CoreView {
  kind: "CORE";
  id: string;
  controlled: boolean;
  owner_username: string;
  position: Position;
  hp: number;
  shield: number;
  state: CoreState;
  move_direction: Direction | null;
  move_progress: number | null;
  move_required_ticks: number | null;
  destination: Position | null;
}

/** A controlled or visible Unit. */
export interface UnitView {
  kind: "UNIT";
  id: string;
  controlled: boolean;
  position: Position;
  hp: number;
  unit_type: UnitType;
  cargo: number | null;
}

/** A controlled Core or Unit seen in the player state. */
export type WorldObject = TerrainView | CoreView | UnitView;

/** Typed values from a CORE_RESOURCES_CAPTURED result. */
export interface CoreResourceCapture {
  amount: number;
  available: number;
  destroyed: number;
  capacity: number;
}

/** Typed values from a successful Unit or Core heal result. */
export interface HealingResult {
  amount: number;
  hp: number;
  cost: number;
}

/** A private result produced while resolving the previous Tick. */
export interface ResolutionEvent {
  event_id: string;
  tick: number;
  event_type: string;
  reason_code: string | null;
  actor_id: string | null;
  target_id: string | null;
  position: Position | null;
  values: Record<string, unknown> | null;
}

const RESOURCE_EVENT_TYPES = new Set([
  "CORE_RESOURCES_CAPTURED",
  "CORE_RESOURCE_OVERFLOW_DESTROYED",
  "DEPOSIT_SUCCEEDED",
  "HARVEST_SUCCEEDED",
  "WORKER_CARGO_DROPPED",
]);

/** A complete authoritative player-state replacement. */
export interface PlayerState {
  status: PlayerStatus;
  respawn_at_tick: number | null;
  resources: number;
  population: number;
  population_tier: number;
  upkeep_next_tick: number;
  champion_beacon: ChampionBeacon;
  objects: readonly WorldObject[];
  events: readonly ResolutionEvent[];
}

/** Notice that a new logical Tick has started. */
export interface Tick {
  tick: number;
}

/** The latest canonical complete plan stored for one source. */
export interface Received {
  tick: number;
  source: CommandSource;
  received_at: string;
  plan: CommandPlan;
}

// ---- 窄校验：网络边界解析后的防御性检查（对应上游 pydantic model_validator） ----

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asPosition(value: unknown, context: string): Position {
  if (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number"
  ) {
    return [value[0], value[1]] as const;
  }
  throw new ProtocolError(`invalid position in ${context}`);
}

function asString(value: unknown, field: string, context: string): string {
  if (typeof value !== "string") {
    throw new ProtocolError(`invalid ${field} in ${context}`);
  }
  return value;
}

export function parseBeacon(value: unknown): ChampionBeacon {
  if (!isRecord(value)) {
    throw new ProtocolError("invalid beacon");
  }
  const status = value.status == null ? null : asString(value.status, "status", "beacon");
  if (status !== null && status !== BS.GROUND && status !== BS.CARRIED) {
    throw new ProtocolError(`invalid beacon status: ${status}`);
  }
  const carrierId = value.carrier_id == null ? null : asString(value.carrier_id, "carrier_id", "beacon");
  if (status === BS.CARRIED && carrierId === null) {
    throw new ProtocolError("carrier_id is required when status is CARRIED");
  }
  if (status !== BS.CARRIED && carrierId !== null) {
    throw new ProtocolError("carrier_id is only valid when status is CARRIED");
  }
  return {
    position: asPosition(value.position, "beacon"),
    status: status as BeaconStatus | null,
    carrier_id: carrierId,
  };
}

export function parseWorldObject(value: unknown): WorldObject {
  if (!isRecord(value) || typeof value.kind !== "string") {
    throw new ProtocolError("invalid world object");
  }
  if (value.kind === "OBSTACLE" || value.kind === "RESOURCE") {
    if (!Array.isArray(value.positions) || value.positions.length === 0) {
      throw new ProtocolError("terrain positions must be non-empty");
    }
    const positions = value.positions.map((p) => asPosition(p, "terrain"));
    return { kind: value.kind, positions } satisfies TerrainView;
  }
  if (value.kind === "CORE") {
    const state = asString(value.state, "state", "core");
    if (state !== CSt.NORMAL && state !== CSt.MOVING) {
      throw new ProtocolError(`invalid core state: ${state}`);
    }
    const movement = [value.move_direction, value.move_progress, value.move_required_ticks, value.destination];
    if (state === CSt.MOVING && movement.some((m) => m == null)) {
      throw new ProtocolError("MOVING Core requires all movement fields");
    }
    if (state === CSt.NORMAL && movement.some((m) => m != null)) {
      throw new ProtocolError("NORMAL Core cannot contain movement fields");
    }
    return {
      kind: "CORE",
      id: asString(value.id, "id", "core"),
      controlled: value.controlled === true,
      owner_username: asString(value.owner_username, "owner_username", "core"),
      position: asPosition(value.position, "core"),
      hp: value.hp as number,
      shield: value.shield as number,
      state: state as CoreState,
      move_direction: value.move_direction == null ? null : (value.move_direction as Direction),
      move_progress: value.move_progress == null ? null : (value.move_progress as number),
      move_required_ticks: value.move_required_ticks == null ? null : (value.move_required_ticks as number),
      destination: value.destination == null ? null : asPosition(value.destination, "core"),
    } satisfies CoreView;
  }
  if (value.kind === "UNIT") {
    const unitType = asString(value.unit_type, "unit_type", "unit");
    if (unitType !== UT.WORKER && unitType !== UT.VANGUARD && unitType !== UT.RANGER) {
      throw new ProtocolError(`invalid unit type: ${unitType}`);
    }
    const cargo = value.cargo == null ? null : (value.cargo as number);
    if (cargo !== null && (value.controlled !== true || unitType !== UT.WORKER)) {
      throw new ProtocolError("cargo is only valid for a controlled Worker");
    }
    return {
      kind: "UNIT",
      id: asString(value.id, "id", "unit"),
      controlled: value.controlled === true,
      position: asPosition(value.position, "unit"),
      hp: value.hp as number,
      unit_type: unitType as UnitType,
      cargo,
    } satisfies UnitView;
  }
  throw new ProtocolError(`unknown world object kind: ${value.kind}`);
}

export function parseEvent(value: unknown): ResolutionEvent {
  if (!isRecord(value)) {
    throw new ProtocolError("invalid resolution event");
  }
  return {
    event_id: asString(value.event_id, "event_id", "event"),
    tick: value.tick as number,
    event_type: asString(value.event_type, "event_type", "event"),
    reason_code: value.reason_code == null ? null : (value.reason_code as string),
    actor_id: value.actor_id == null ? null : (value.actor_id as string),
    target_id: value.target_id == null ? null : (value.target_id as string),
    position: value.position == null ? null : asPosition(value.position, "event"),
    values: value.values == null ? null : (value.values as Record<string, unknown>),
  };
}

export function parsePlayerState(value: unknown): PlayerState {
  if (!isRecord(value)) {
    throw new ProtocolError("invalid player state");
  }
  const status = asString(value.status, "status", "player state");
  if (status !== PS.ACTIVE && status !== PS.RESPAWNING) {
    throw new ProtocolError(`invalid player status: ${status}`);
  }
  const respawnAtTick = value.respawn_at_tick == null ? null : (value.respawn_at_tick as number);
  if (status === PS.RESPAWNING && respawnAtTick === null) {
    throw new ProtocolError("RESPAWNING state requires respawn_at_tick");
  }
  if (status === PS.ACTIVE && respawnAtTick !== null) {
    throw new ProtocolError("ACTIVE state cannot contain respawn_at_tick");
  }
  if (!Array.isArray(value.objects)) {
    throw new ProtocolError("player state objects must be an array");
  }
  if (!Array.isArray(value.events)) {
    throw new ProtocolError("player state events must be an array");
  }
  return {
    status: status as PlayerStatus,
    respawn_at_tick: respawnAtTick,
    resources: value.resources as number,
    population: value.population as number,
    population_tier: value.population_tier as number,
    upkeep_next_tick: value.upkeep_next_tick as number,
    champion_beacon: parseBeacon(value.champion_beacon),
    objects: value.objects.map(parseWorldObject),
    events: value.events.map(parseEvent),
  };
}

// ---- ResolutionEvent 辅助属性（对应上游 pydantic property） ----

/** Amount carried by a resource event, when available. */
export function eventResourceAmount(ev: ResolutionEvent): number | null {
  if (!RESOURCE_EVENT_TYPES.has(ev.event_type) || ev.values == null) {
    return null;
  }
  const amount = ev.values.amount;
  return typeof amount === "number" && Number.isInteger(amount) && amount > 0 ? amount : null;
}

/** Typed Core loot values when the event is well formed. */
export function eventCoreResourceCapture(ev: ResolutionEvent): CoreResourceCapture | null {
  if (ev.event_type !== "CORE_RESOURCES_CAPTURED" || ev.values == null) {
    return null;
  }
  const v = ev.values;
  if (
    typeof v.amount === "number" && typeof v.available === "number" &&
    typeof v.destroyed === "number" && typeof v.capacity === "number"
  ) {
    return { amount: v.amount, available: v.available, destroyed: v.destroyed, capacity: v.capacity };
  }
  return null;
}

/** Typed values from a successful Unit or Core heal. */
export function eventHealing(ev: ResolutionEvent): HealingResult | null {
  if (
    ev.event_type !== "UNIT_HEAL_SUCCEEDED" && ev.event_type !== "CORE_HEAL_SUCCEEDED" ||
    ev.values == null
  ) {
    return null;
  }
  const v = ev.values;
  if (typeof v.amount === "number" && typeof v.hp === "number" && typeof v.cost === "number") {
    return { amount: v.amount, hp: v.hp, cost: v.cost };
  }
  return null;
}

/** The natural-node or dropped-cargo source for a harvest. */
export function eventHarvestSource(ev: ResolutionEvent): HarvestSource | null {
  if (ev.event_type !== "HARVEST_SUCCEEDED" || ev.values == null) {
    return null;
  }
  const source = ev.values.source;
  if (typeof source !== "string" || (source !== "RESOURCE_NODE" && source !== "DROPPED_CARGO")) {
    return null;
  }
  return source as HarvestSource;
}

/** Validate a Received envelope (plan tick must match receipt tick). */
export function checkReceivedConsistency(rec: Received): void {
  if (rec.plan.tick !== rec.tick) {
    throw new ProtocolError("received plan tick does not match receipt tick");
  }
  if (rec.source !== CS.AGENT && rec.source !== CS.MANUAL) {
    throw new ProtocolError(`invalid command source: ${rec.source}`);
  }
}
