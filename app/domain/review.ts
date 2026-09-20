import type { FindingState, HumanReviewState, ResolveAction } from "./types";

export type ReviewRow = {
  id: string;
  shopId: string;
  evaluationId: string;
  orderId: string;
  rowVersion: number;
  state: FindingState;
  humanReview: HumanReviewState;
};

export type ReviewRequest = {
  action: ResolveAction;
  evaluationId: string;
  rowVersion: number;
  note?: string;
  resolutionCategory?: string;
  dismissReason?: string;
  isConflict?: boolean;
};

export type ReviewResult =
  | { ok: true; next: ReviewRow }
  | { ok: false; status: 400 | 409; error: string };

export function applyReviewTransition(row: ReviewRow, request: ReviewRequest): ReviewResult {
  if (row.evaluationId !== request.evaluationId || row.rowVersion !== request.rowVersion) {
    return { ok: false, status: 409, error: "stale_revision" };
  }

  if (request.action === "mark_reviewed") {
    if (request.isConflict && !request.note) {
      return { ok: false, status: 400, error: "conflict_note_required" };
    }
    if (!request.resolutionCategory) {
      return { ok: false, status: 400, error: "resolution_category_required" };
    }
    return {
      ok: true,
      next: {
        ...row,
        state: "resolved",
        humanReview: "reviewed",
        rowVersion: row.rowVersion + 1,
      },
    };
  }

  if (request.action === "awaiting_customer") {
    return {
      ok: true,
      next: {
        ...row,
        state: "awaiting_customer",
        humanReview: "in_review",
        rowVersion: row.rowVersion + 1,
      },
    };
  }

  if (request.action === "dismiss") {
    if (!request.dismissReason) {
      return { ok: false, status: 400, error: "dismiss_reason_required" };
    }
    return {
      ok: true,
      next: {
        ...row,
        state: "dismissed",
        humanReview: "reviewed",
        rowVersion: row.rowVersion + 1,
      },
    };
  }

  if (request.action === "reopen") {
    if (row.state !== "resolved" && row.state !== "dismissed" && row.state !== "awaiting_customer") {
      return { ok: false, status: 400, error: "cannot_reopen" };
    }
    return {
      ok: true,
      next: {
        ...row,
        state: "open",
        humanReview: "not_reviewed",
        rowVersion: row.rowVersion + 1,
      },
    };
  }

  return { ok: false, status: 400, error: "invalid_action" };
}

export function canMutateReview(role: string): boolean {
  return role === "owner" || role === "reviewer" || role === "system_worker";
}
