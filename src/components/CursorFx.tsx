/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from "react";

/**
 * Tasteful pointer flourishes:
 *  - a soft ring that smoothly trails the cursor (grows over interactive elements)
 *  - a ripple burst on every click
 * Disabled on touch / coarse pointers and when the user prefers reduced motion.
 */
export default function CursorFx() {
  const ringRef = useRef<HTMLDivElement>(null);
  const [enabled, setEnabled] = useState(false);
  const [ripples, setRipples] = useState<
    { id: number; x: number; y: number }[]
  >([]);

  const target = useRef({ x: -100, y: -100 });
  const ring = useRef({ x: -100, y: -100 });
  const scale = useRef(1);
  const targetScale = useRef(1);
  const hovering = useRef(false);
  const idRef = useRef(0);

  useEffect(() => {
    const fine = window.matchMedia("(pointer: fine)").matches;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!fine || reduce) return;
    setEnabled(true);

    const onMove = (e: MouseEvent) => {
      target.current = { x: e.clientX, y: e.clientY };
    };
    const onDown = (e: MouseEvent) => {
      const id = idRef.current++;
      setRipples((r) => [...r, { id, x: e.clientX, y: e.clientY }]);
      window.setTimeout(
        () => setRipples((r) => r.filter((x) => x.id !== id)),
        650,
      );
      targetScale.current = 0.6;
      window.setTimeout(() => {
        targetScale.current = hovering.current ? 1.8 : 1;
      }, 120);
    };
    const onOver = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      const interactive = el?.closest(
        "button, a, [role='button'], input, select, textarea, label",
      );
      hovering.current = Boolean(interactive);
      targetScale.current = interactive ? 1.8 : 1;
    };

    let raf = 0;
    const loop = () => {
      ring.current.x += (target.current.x - ring.current.x) * 0.2;
      ring.current.y += (target.current.y - ring.current.y) * 0.2;
      scale.current += (targetScale.current - scale.current) * 0.2;
      if (ringRef.current) {
        ringRef.current.style.transform = `translate(${ring.current.x}px, ${ring.current.y}px) translate(-50%, -50%) scale(${scale.current})`;
      }
      raf = requestAnimationFrame(loop);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("mouseover", onOver);
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseover", onOver);
    };
  }, []);

  if (!enabled) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[9999] overflow-hidden">
      <div
        ref={ringRef}
        className="absolute top-0 left-0 w-7 h-7 rounded-full border border-primary/60"
        style={{ willChange: "transform" }}
      />
      {ripples.map((r) => (
        <span
          key={r.id}
          className="absolute rounded-full bg-primary/30 animate-civic-ripple"
          style={{
            left: r.x,
            top: r.y,
            width: 12,
            height: 12,
            marginLeft: -6,
            marginTop: -6,
          }}
        />
      ))}
    </div>
  );
}
