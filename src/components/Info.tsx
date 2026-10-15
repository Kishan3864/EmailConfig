"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./icons";

const WIDTH = 280;

/**
 * Small (i) button. Hover (mouse) or tap (touch) shows a short explanation in Hinglish; a click keeps it open.
 * It is a span with role="button" (not a <button>), so inside a <label> the label still belongs to its input,
 * and it has an invisible ~32px hit area so a slightly missed tap does not hit the link or field around it.
 */
export function Info({ text, title, size = 14, className = "", focusable = true }: { text: ReactNode; title?: string; size?: number; className?: string; focusable?: boolean }) {
  const btn = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pinned = useRef(false); // opened by click / tap / keyboard: stays open until closed on purpose
  const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number } | null>(null);

  const open = () => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    const width = Math.min(WIDTH, vw - 24);
    const left = Math.min(Math.max(12, r.left + r.width / 2 - width / 2), vw - width - 12);
    setPos(r.top > vh * 0.55 ? { left, width, bottom: vh - r.top + 8 } : { left, width, top: r.bottom + 8 });
  };
  const close = () => { pinned.current = false; setPos(null); };
  const later = (fn: () => void) => { clearTimeout(timer.current); timer.current = setTimeout(fn, 120); };
  const toggle = () => {
    clearTimeout(timer.current);
    if (pos && pinned.current) return close();
    pinned.current = true;
    if (!pos) open();
  };
  const hoverClose = () => { if (!pinned.current) later(close); };

  useEffect(() => {
    if (!pos) return;
    const onDown = (e: PointerEvent) => {
      const el = e.target as Element | null;
      if (!btn.current?.contains(el) && !el?.closest?.("[data-info-pop]")) close();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [pos]);

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <>
      <span
        ref={btn}
        role="button"
        tabIndex={focusable ? 0 : -1}
        aria-label={title ? `${title}: jaankari` : "Jaankari"}
        aria-expanded={!!pos}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggle(); }}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); toggle(); } }}
        onPointerEnter={(e) => { if (e.pointerType === "mouse" && !pos) later(open); }}
        onPointerLeave={(e) => { if (e.pointerType === "mouse") hoverClose(); }}
        className={`relative inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full align-middle transition before:absolute before:-inset-2 before:content-[''] hover:text-indigo-600 ${pos ? "text-indigo-600" : "text-slate-400"} ${className}`}
      >
        <Icon name="info" size={size} />
      </span>
      {pos && createPortal(
        <div
          data-info-pop
          role="tooltip"
          style={{ position: "fixed", left: pos.left, top: pos.top, bottom: pos.bottom, width: pos.width }}
          // React bubbles events out of a portal to its React parents: never let a click here reach a Link around the (i)
          onClick={(e) => e.stopPropagation()}
          onPointerEnter={(e) => { if (e.pointerType === "mouse") clearTimeout(timer.current); }}
          onPointerLeave={(e) => { if (e.pointerType === "mouse") hoverClose(); }}
          className="z-[95] animate-pop-in rounded-xl bg-slate-900 px-3.5 py-3 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-slate-200 shadow-pop"
        >
          {title && <div className="mb-1 flex items-center gap-1.5 font-semibold text-white"><Icon name="info" size={13} className="text-indigo-300" />{title}</div>}
          <div className="whitespace-pre-line">{text}</div>
        </div>,
        document.body,
      )}
    </>
  );
}
