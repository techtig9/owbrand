import { Skeleton } from '@/components/ui';
/** Dashboard-specific skeleton, shaped like the real overview content. */
export default function DashboardLoading() {
  return (
    <div className="mx-auto w-full max-w-7xl space-y-7" role="status" aria-label="Loading dashboard">
      <div className="space-y-3">
        <Skeleton className="h-4 w-40 rounded-lg" />
        <Skeleton className="h-9 w-72 rounded-xl" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-24 rounded-2xl" />
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        <Skeleton className="h-72 rounded-2xl" />
        <Skeleton className="h-72 rounded-2xl" />
      </div>
      <span className="sr-only">Loading dashboard…</span>
    </div>
  );
}
