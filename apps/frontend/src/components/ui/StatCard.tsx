type StatCardProps = {
  title: string;
  count: number | string;
  color?: string;
  icon?: React.ReactNode;
};

/** Same pill shape as EPCCRM's StatusCard: icon circle + label + count. */
export default function StatCard({ title, count, color, icon }: StatCardProps) {
  return (
    <div className="min-w-0 rounded-full border border-white/20 py-1.5 pl-2 pr-4 shadow-[0_14px_44px_0_rgb(0_0_0/0.25)] xl:py-2">
      <div className="flex flex-row items-center gap-2 xl:gap-3">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/25 shadow-[0_0_30px_0_rgb(0_0_0/0.08)] xl:h-10 xl:w-10">
          {icon ?? (
            <span
              className="block h-2.5 w-2.5 rounded-full xl:h-3 xl:w-3"
              style={{ backgroundColor: color ?? '#fff' }}
            />
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-row items-center justify-between gap-2">
          <p className="min-w-0 truncate text-xs text-white xl:text-sm" title={title}>
            {title}
          </p>
          <p className="shrink-0 text-base font-bold text-white xl:text-xl">
            {count}
          </p>
        </div>
      </div>
    </div>
  );
}
