import type { StaffRole } from "./types";

export function roleFromVerifiedStaff(args: {
  verifiedStaffId: string | null;
  recordedRole: StaffRole | null;
  accountOwner?: boolean;
}): StaffRole {
  if (!args.verifiedStaffId) return "unidentified";
  if (args.recordedRole) return args.recordedRole;
  return "unidentified";
}

export function assertNeverDefaultOwner(role: StaffRole): void {
  if (!role) {
    throw new Error("Unidentified staff cannot be defaulted to owner");
  }
}

export function canConfigure(role: StaffRole): boolean {
  return role === "owner";
}

export function canReview(role: StaffRole): boolean {
  return role === "owner" || role === "reviewer";
}

export function canRead(role: StaffRole): boolean {
  return role === "owner" || role === "reviewer" || role === "viewer" || role === "system_worker";
}
