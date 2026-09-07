/** Dashboard-specific skeleton, shaped like the real overview content. */
export default function DashboardLoading() {
  return (
    <div className="mx-auto w-full max-w-7xl space-y-7" role="status" aria-label="Loading dashboard">
      <div className="space-y-3">
        <div className="h-4 w-40 animate-pulse rounded-lg bg-canvas-alt" />
        <div className="h-9 w-72 animate-pulse rounded-xl bg-canvas-alt" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-2xl bg-canvas-alt" />
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        <div className="h-72 animate-pulse rounded-2xl bg-canvas-alt" />
        <div className="h-72 animate-pulse rounded-2xl bg-canvas-alt" />
      </div>
      <span className="sr-only">Loading dashboard…</span>
    </div>
  );
}
