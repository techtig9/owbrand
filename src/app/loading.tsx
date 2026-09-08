/**
 * Root loading state. Uses skeleton blocks rather than a spinner so the page
 * does not visibly jump when content arrives.
 */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-6" role="status" aria-label="Loading">
      <div className="h-8 w-56 animate-pulse rounded-xl bg-surface-raised" />
      <div className="h-4 w-80 animate-pulse rounded-lg bg-surface-raised" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-28 animate-pulse rounded-2xl bg-surface-raised" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-2xl bg-surface-raised" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
