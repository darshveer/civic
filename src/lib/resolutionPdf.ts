/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * In-browser resolution-report PDF generator (pdf-lib). Produces a downloadable
 * one/two-page report for a Resolved (or re-escalated) issue: details, who
 * resolved it, how long it took, AI confidence, and before/after images — plus
 * a re-escalation history with previous-vs-new fix images when present.
 *
 * Runs entirely client-side (no server, no storage), so it stays within the
 * Google AI Studio + Firebase deployment model.
 */

import { PDFDocument, StandardFonts, rgb, PDFPage, PDFFont } from "pdf-lib";
import { CivicIssue } from "../types";

const BLUE = rgb(0x1c / 255, 0x45 / 255, 0x87 / 255);
const MID = rgb(0x11 / 255, 0x55 / 255, 0xcc / 255);
const BODY = rgb(0x20 / 255, 0x20 / 255, 0x24 / 255);
const GREY = rgb(0.42, 0.45, 0.5);

function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; kind: "jpg" | "png" } | null {
  try {
    const m = /^data:(image\/(\w+));base64,(.*)$/.exec(dataUrl || "");
    if (!m) return null;
    const kind = m[2].toLowerCase() === "png" ? "png" : "jpg";
    const bin = atob(m[3]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { bytes, kind };
  } catch {
    return null;
  }
}

async function embed(pdf: PDFDocument, dataUrl?: string) {
  if (!dataUrl) return null;
  const parsed = dataUrlToBytes(dataUrl);
  if (!parsed) return null;
  try {
    return parsed.kind === "png"
      ? await pdf.embedPng(parsed.bytes)
      : await pdf.embedJpg(parsed.bytes);
  } catch {
    try {
      return await pdf.embedPng(parsed.bytes);
    } catch {
      return null;
    }
  }
}

const fmt = (ms?: number) => (ms ? new Date(ms).toLocaleString() : "—");

function durationText(fromMs?: number, toMs?: number): string {
  if (!fromMs || !toMs || toMs < fromMs) return "—";
  const h = (toMs - fromMs) / 3.6e6;
  if (h < 1) return `${Math.round(h * 60)} minutes`;
  if (h < 48) return `${h.toFixed(1)} hours`;
  return `${(h / 24).toFixed(1)} days`;
}

export async function buildResolutionPdf(issue: CivicIssue): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([595, 842]); // A4 portrait (pt)
  const M = 48;
  let y = 800;

  const line = (text: string, size: number, f: PDFFont, color = BODY, gap = 6) => {
    page.drawText(text, { x: M, y, size, font: f, color });
    y -= size + gap;
  };
  const ensure = (need: number) => {
    if (y - need < 60) {
      page = pdf.addPage([595, 842]);
      y = 800;
    }
  };

  // Header band
  page.drawRectangle({ x: 0, y: 812, width: 595, height: 30, color: BLUE });
  page.drawText("CIVIC — Resolution Report", {
    x: M, y: 820, size: 13, font: bold, color: rgb(1, 1, 1),
  });
  y = 790;

  line(issue.category + "  ·  Report " + issue.id.slice(0, 8), 16, bold, BLUE, 4);
  line(issue.description?.slice(0, 140) || "—", 10, font, GREY, 12);

  // Details table (label: value)
  const rows: [string, string][] = [
    ["Status", issue.status],
    ["Severity", `${issue.severityScore}/10  (${issue.priorityTier || "P3"}, ${issue.slaTargetHours || 72}h SLA)`],
    ["Department", issue.recommendedDepartment || "—"],
    ["Location", [issue.ward, issue.zone, issue.city, issue.state].filter(Boolean).join(", ") || issue.address || "—"],
    ["Reported by", `${issue.reportedByName || "Citizen"}${issue.reportedByPhone ? "  ·  " + issue.reportedByPhone : ""}`],
    ["Source", issue.source || "citizen-photo"],
    ["Reported at", fmt(issue.reportedAt)],
    ["Resolved at", fmt(issue.resolvedAt)],
    ["Time to resolve", durationText(issue.reportedAt, issue.resolvedAt)],
    ["Resolved by (uid)", issue.resolvedByUid || "—"],
    ["AI confidence", typeof issue.resolutionConfidence === "number" ? `${issue.resolutionConfidence}%` : "—"],
  ];
  for (const [k, v] of rows) {
    ensure(18);
    page.drawText(k, { x: M, y, size: 9, font: bold, color: MID });
    page.drawText(v, { x: M + 130, y, size: 9, font, color: BODY, maxWidth: 595 - M - 130 - M });
    y -= 16;
  }
  if (issue.resolutionNotes) {
    y -= 4;
    ensure(40);
    line("Resolution notes", 10, bold, MID, 4);
    // naive wrap
    const words = issue.resolutionNotes.split(/\s+/);
    let lineStr = "";
    for (const w of words) {
      if ((lineStr + " " + w).length > 95) {
        ensure(14);
        line(lineStr, 9, font, BODY, 2);
        lineStr = w;
      } else lineStr = lineStr ? lineStr + " " + w : w;
    }
    if (lineStr) { ensure(14); line(lineStr, 9, font, BODY, 8); }
  }

  // Before / After images
  const before = await embed(pdf, issue.imageUrl);
  const after = await embed(pdf, issue.resolvedImageUrl);
  if (before || after) {
    ensure(170);
    line("Before / After", 11, bold, BLUE, 6);
    const boxW = (595 - M * 2 - 16) / 2;
    const boxH = 130;
    const drawBox = (img: any, label: string, x: number) => {
      page.drawText(label, { x, y, size: 8, font: bold, color: GREY });
      if (img) {
        const scale = Math.min(boxW / img.width, (boxH - 14) / img.height);
        page.drawImage(img, {
          x,
          y: y - 14 - img.height * scale,
          width: img.width * scale,
          height: img.height * scale,
        });
      } else {
        page.drawText("(no image)", { x, y: y - 30, size: 8, font, color: GREY });
      }
    };
    drawBox(before, "BEFORE", M);
    drawBox(after, "AFTER", M + boxW + 16);
    y -= boxH + 10;
  }

  // Re-escalation history
  if (issue.escalationHistory && issue.escalationHistory.length) {
    ensure(40);
    line("Re-escalation history", 11, bold, BLUE, 6);
    let i = 1;
    for (const rec of issue.escalationHistory) {
      ensure(150);
      line(
        `#${i}  Re-opened ${fmt(rec.at)}${rec.reason ? ` — "${rec.reason}"` : ""}`,
        9, bold, BODY, 4,
      );
      const prev = await embed(pdf, rec.previousResolvedImageUrl);
      if (prev) {
        const scale = Math.min((595 - M * 2) / prev.width, 110 / prev.height);
        page.drawText("Previous resolution photo:", { x: M, y, size: 8, font, color: GREY });
        y -= 12;
        page.drawImage(prev, { x: M, y: y - prev.height * scale, width: prev.width * scale, height: prev.height * scale });
        y -= prev.height * scale + 10;
      }
      i++;
    }
  }

  ensure(20);
  page.drawText("Generated by CIVIC · " + new Date().toLocaleString(), {
    x: M, y: 40, size: 7, font, color: GREY,
  });

  return pdf.save();
}

/** Builds the PDF and triggers a browser download. */
export async function downloadResolutionPdf(issue: CivicIssue): Promise<void> {
  const bytes = await buildResolutionPdf(issue);
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `CIVIC_report_${issue.id.slice(0, 8)}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
