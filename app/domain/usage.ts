export type UsageCycle = {
  shopId: string;
  cycleId: string;
  entitlement: number;
  consumed: number;
  reserved: number;
  status: "active" | "grace" | "paused" | "trial";
  graceUntil: string | null;
};

export type ReservationResult =
  | { ok: true; reservationId: string }
  | { ok: false; reason: "plan_limit" | "paused" | "already_counted" };

export function canReserve(cycle: UsageCycle, alreadyCounted: boolean): ReservationResult {
  if (alreadyCounted) return { ok: false, reason: "already_counted" };
  if (cycle.status === "paused") return { ok: false, reason: "paused" };
  if (cycle.consumed + cycle.reserved >= cycle.entitlement) {
    return { ok: false, reason: "plan_limit" };
  }
  return { ok: true, reservationId: "pending" };
}

export function applyReservation(cycle: UsageCycle): UsageCycle {
  return { ...cycle, reserved: cycle.reserved + 1 };
}

export function completeReservation(cycle: UsageCycle): UsageCycle {
  return {
    ...cycle,
    reserved: Math.max(0, cycle.reserved - 1),
    consumed: cycle.consumed + 1,
  };
}

export function releaseReservation(cycle: UsageCycle): UsageCycle {
  return { ...cycle, reserved: Math.max(0, cycle.reserved - 1) };
}

export function graceExpired(cycle: UsageCycle, now: Date): boolean {
  if (cycle.status !== "grace" || !cycle.graceUntil) return false;
  return now.toISOString() >= cycle.graceUntil;
}
