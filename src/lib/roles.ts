/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Municipal-hierarchy RBAC helpers.
 *
 * The single server-enforced source of staff truth is the Firestore document
 * `config/roles` (see RolesConfig). `config/wards` maps each ward to its parent
 * zone. The client derives a UserScope from these; Firestore Security Rules
 * enforce the same checks so the UI and the database agree.
 *
 * This is intentionally an allowlist model (not Admin-SDK custom claims) so the
 * app needs no service-account secret and stays hostable on Google AI Studio.
 */

import { doc, getDoc } from "firebase/firestore";
import { db } from "./firebase";
import {
  CivicIssue,
  CivicStatus,
  RolesConfig,
  StaffTier,
  UserScope,
  WardsConfig,
} from "../types";

const CITIZEN_SCOPE: UserScope = { role: "citizen", wards: [] };

/**
 * The only statuses staff may assign from the dashboard/board.
 *
 * Deliberately excluded:
 *  - "Reported"                     → reports auto-route on submission.
 *  - "Requires Human Verification"  → duplicated "Flagged for Review".
 *  - "Corroborated Report"          → same outcome as "Staff Verified".
 *  - "Community Verified"           → earned by community consensus, never set
 *                                     by staff (they promote to Staff Verified).
 * These legacy/community values remain in CivicStatus so existing reports still
 * render; they're simply not offered as choices.
 */
export const STAFF_ASSIGNABLE_STATUSES: CivicStatus[] = [
  "Auto-Routed",
  "Pending Verification",
  "Staff Verified",
  "Flagged for Review",
  "In Progress",
  "Resolved",
];

/**
 * Status options for an editable dropdown bound to `current`. Guarantees the
 * issue's current status is always selectable — even when it's a legacy or
 * community-only value no longer offered for new assignment — so the control
 * never renders blank.
 */
export function statusOptions(current: CivicStatus): CivicStatus[] {
  return STAFF_ASSIGNABLE_STATUSES.includes(current)
    ? STAFF_ASSIGNABLE_STATUSES
    : [current, ...STAFF_ASSIGNABLE_STATUSES];
}

/** Human-readable label for the few statuses whose stored value differs. */
export function statusLabel(status: CivicStatus | string): string {
  if (status === "Requires Human Verification") return "Verify Report";
  if (status === "Corroborated Report") return "Corroborated";
  return status;
}

/**
 * Loads the staff registry. Returns an empty registry if the doc is missing or
 * unreadable (everyone is then a citizen — safe default).
 */
export async function loadRolesConfig(): Promise<RolesConfig> {
  try {
    const snap = await getDoc(doc(db, "config", "roles"));
    if (snap.exists()) {
      const data = snap.data() as Partial<RolesConfig>;
      return { staff: data.staff || {} };
    }
  } catch (err) {
    console.warn("Could not load config/roles; defaulting to citizen-only.", err);
  }
  return { staff: {} };
}

/**
 * Loads the ward → zone map. Returns an empty map on failure.
 */
export async function loadWardsConfig(): Promise<WardsConfig> {
  try {
    const snap = await getDoc(doc(db, "config", "wards"));
    if (snap.exists()) {
      const data = snap.data() as Partial<WardsConfig>;
      return { wardToZone: data.wardToZone || {} };
    }
  } catch (err) {
    console.warn("Could not load config/wards; zone lookups disabled.", err);
  }
  return { wardToZone: {} };
}

/**
 * Resolves the authoritative permission scope for a uid from the registry.
 * A uid not present in the registry is a citizen.
 */
export function resolveUserScope(
  uid: string | undefined,
  roles: RolesConfig,
): UserScope {
  if (!uid) return CITIZEN_SCOPE;
  const member = roles.staff?.[uid];
  if (!member) return CITIZEN_SCOPE;
  return {
    role: "staff",
    tier: member.tier,
    wards: member.tier === "field" ? member.wards || [] : [],
    zone: member.tier === "zonal" ? member.zone : undefined,
  };
}

/**
 * Looks up the zone for a ward.
 */
export function zoneForWard(
  ward: string | undefined,
  wards: WardsConfig,
): string | undefined {
  if (!ward) return undefined;
  return wards.wardToZone[ward];
}

/**
 * True if the staff member's scope covers the given issue.
 *  - city  → everything
 *  - zonal → any issue whose zone matches their zone
 *  - field → any issue whose ward is in their assigned wards
 * Citizens never have action scope.
 */
export function canActOnIssue(scope: UserScope, issue: CivicIssue): boolean {
  if (scope.role !== "staff") return false;
  switch (scope.tier) {
    case "city":
      return true;
    case "zonal":
      return Boolean(issue.zone) && issue.zone === scope.zone;
    case "field":
      return Boolean(issue.ward) && scope.wards.includes(issue.ward);
    default:
      return false;
  }
}

/**
 * Filters a list of issues down to those a staff member is responsible for.
 * City admins see everything; this is the default scoping for staff views.
 */
export function issuesInScope(
  scope: UserScope,
  issues: CivicIssue[],
): CivicIssue[] {
  if (scope.role !== "staff") return [];
  if (scope.tier === "city") return issues;
  return issues.filter((i) => canActOnIssue(scope, i));
}

/**
 * Human-readable label for a staff tier (for headers/badges).
 */
export function tierLabel(tier: StaffTier | undefined): string {
  switch (tier) {
    case "city":
      return "City Administrator";
    case "zonal":
      return "Zonal Supervisor";
    case "field":
      return "Ward Officer";
    default:
      return "Municipal Staff";
  }
}
