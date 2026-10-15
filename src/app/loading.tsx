"use client";
import { useT } from "@/components/lang";

/** Shown instantly while a page loads, so navigation feels like an app. */
export default function Loading() {
  const { t } = useT();
  return (
    <div className="animate-fade-in space-y-5" aria-busy="true" aria-label={t("Load ho raha hai", "Loading")}>
      <div className="space-y-2">
        <div className="skeleton h-6 w-48" />
        <div className="skeleton h-3.5 w-72 max-w-full" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card space-y-3">
            <div className="skeleton h-3 w-24" />
            <div className="skeleton h-6 w-16" />
          </div>
        ))}
      </div>
      <div className="card space-y-3">
        {[0, 1, 2, 3, 4].map((i) => <div key={i} className="skeleton h-4 w-full" />)}
      </div>
    </div>
  );
}
