type StatCardProps = {
  title: string;
  count: number | string;
  icon?: React.ReactNode;
  color?: string;
};

/** Copied 1:1 from EPCCRM's StatusCard. */
export default function StatCard({
  title,
  count,
  color,
  icon = (
    <span
      className="block h-2.5 w-2.5 rounded-full xl:h-3.5 xl:w-3.5 2xl:h-4 2xl:w-4"
      style={{ backgroundColor: color ?? '#fff' }}
    />
  ),
}: StatCardProps) {
  return (
    <div className="min-w-0 border border-white/20 shadow-[0_14px_44px_0_rgb(0_0_0/0.25)] py-1 xl:py-2 pl-2 pr-4 rounded-full">
      <div className="flex flex-row gap-1 2xl:gap-3 items-center">
        <div className="bg-white/24 w-6 h-6 xl:w-9 xl:h-9 2xl:w-12 2xl:h-12 shrink-0 rounded-full shadow-[0_0_30px_0_rgb(0_0_0/0.08)] flex items-center justify-center">
          {icon}
        </div>
        <div className="flex min-w-0 flex-row items-center justify-between gap-2 flex-1">
          <p className="min-w-0 truncate text-xs 2xl:text-base text-white" title={title}>
            {title}
          </p>
          <p className="shrink-0 text-white text-base 2xl:text-2xl font-bold">
            {count}
          </p>
        </div>
      </div>
    </div>
  );
}
