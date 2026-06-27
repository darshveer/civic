/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import {
  Sprout,
  Flame,
  Shield,
  CircleCheckBig,
  Trophy,
  Crown,
  ThumbsUp,
  Target,
  type LucideIcon,
} from "lucide-react";
import { CivicIssue } from "../types";

/** Aggregate stats a badge can be earned from (all derived from live issues). */
export interface BadgeStats {
  reports: number;
  resolved: number;
  points: number;
  potholes: number;
  categories: number; // distinct categories reported
  upvotesGiven: number; // issues the user upvoted
}

export interface BadgeDef {
  id: string;
  name: string;
  /** What the citizen must do to earn it (shown on hover). */
  requirement: string;
  earned: (s: BadgeStats) => boolean;
  /** Gradient stops for the medal. */
  from: string;
  to: string;
  Icon: LucideIcon;
}

export const BADGES: BadgeDef[] = [
  {
    id: "first-report",
    name: "First Report",
    requirement: "File your first civic report.",
    earned: (s) => s.reports >= 1,
    from: "#34D399",
    to: "#059669",
    Icon: Sprout,
  },
  {
    id: "pothole-hunter",
    name: "Pothole Hunter",
    requirement: "Report at least one pothole.",
    earned: (s) => s.potholes >= 1,
    from: "#FB923C",
    to: "#EA580C",
    Icon: Target,
  },
  {
    id: "verifier",
    name: "Community Verifier",
    requirement: "Upvote / corroborate 3 reports from others.",
    earned: (s) => s.upvotesGiven >= 3,
    from: "#60A5FA",
    to: "#2563EB",
    Icon: ThumbsUp,
  },
  {
    id: "streak-keeper",
    name: "Streak Keeper",
    requirement: "File 5 reports.",
    earned: (s) => s.reports >= 5,
    from: "#F59E0B",
    to: "#B45309",
    Icon: Flame,
  },
  {
    id: "resolver",
    name: "Resolver",
    requirement: "Have one of your reports resolved.",
    earned: (s) => s.resolved >= 1,
    from: "#2DD4BF",
    to: "#0D9488",
    Icon: CircleCheckBig,
  },
  {
    id: "guardian",
    name: "Neighbourhood Guardian",
    requirement: "File 10 reports.",
    earned: (s) => s.reports >= 10,
    from: "#A78BFA",
    to: "#6D28D9",
    Icon: Shield,
  },
  {
    id: "centurion",
    name: "Centurion",
    requirement: "Earn 100 impact points.",
    earned: (s) => s.points >= 100,
    from: "#F472B6",
    to: "#BE185D",
    Icon: Trophy,
  },
  {
    id: "urban-champion",
    name: "Urban Champion",
    requirement: "Earn 300 impact points.",
    earned: (s) => s.points >= 300,
    from: "#FBBF24",
    to: "#D97706",
    Icon: Crown,
  },
];

/** Computes badge stats from the live issues collection for a user. */
export function computeBadgeStats(
  issues: CivicIssue[],
  uid: string | undefined,
  points: number,
): BadgeStats {
  const mine = issues.filter((i) => i.reportedByUid === uid);
  return {
    reports: mine.length,
    resolved: mine.filter((i) => i.status === "Resolved").length,
    points,
    potholes: mine.filter((i) => i.category === "Pothole").length,
    categories: new Set(mine.map((i) => i.category)).size,
    upvotesGiven: issues.filter((i) => (i.upvotedBy || []).includes(uid || ""))
      .length,
  };
}

/**
 * A polished circular medal: gradient disc, glossy highlight, notched ring, and
 * a crisp white emblem. Greyscaled + dimmed when not yet earned.
 */
export function BadgeMedal({
  badge,
  earned,
  size = 56,
}: {
  badge: BadgeDef;
  earned: boolean;
  size?: number;
}) {
  const gid = React.useId().replace(/:/g, "");
  const { Icon } = badge;
  return (
    <div
      className={`relative transition-all duration-300 ${
        earned ? "drop-shadow-md" : "grayscale opacity-70"
      }`}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 64 64" width={size} height={size}>
        <defs>
          <radialGradient id={`disc${gid}`} cx="34%" cy="28%" r="80%">
            <stop offset="0%" stopColor={badge.from} />
            <stop offset="100%" stopColor={badge.to} />
          </radialGradient>
          <linearGradient id={`ring${gid}`} x1="0" y1="0" x2="0" y2="64">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0.4" />
          </linearGradient>
        </defs>
        {/* notched outer ring */}
        {Array.from({ length: 12 }).map((_, i) => (
          <rect
            key={i}
            x="31"
            y="1.5"
            width="2"
            height="6"
            rx="1"
            fill={`url(#ring${gid})`}
            transform={`rotate(${i * 30} 32 32)`}
          />
        ))}
        <circle cx="32" cy="32" r="27" fill={`url(#ring${gid})`} />
        <circle cx="32" cy="32" r="24" fill={`url(#disc${gid})`} />
        {/* glossy highlight */}
        <ellipse cx="26" cy="23" rx="13" ry="8" fill="#ffffff" opacity="0.18" />
      </svg>
      <Icon
        className="absolute inset-0 m-auto text-white"
        style={{ width: size * 0.4, height: size * 0.4 }}
        strokeWidth={2.4}
      />
    </div>
  );
}
