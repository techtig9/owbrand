import { Skeleton } from '@/components/ui';
/**
 * Root loading state. Uses skeleton blocks rather than a spinner so the page
 * does not visibly jump when content arrives.
 */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-6" role="status" aria-label="Loading">
      <Skeleton className="h-8 w-56 rounded-xl" />
      <Skeleton className="h-4 w-80 rounded-lg" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-28 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-2xl" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
