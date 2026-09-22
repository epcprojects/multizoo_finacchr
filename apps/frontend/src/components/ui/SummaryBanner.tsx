'use client';

import { Fragment } from 'react';

type SummaryItem = { title: string; count: number | string; color: string };

type SummaryBannerProps = {
  title: string;
  subtitle?: string;
  stats?: SummaryItem[];
  action?: React.ReactNode;
};

function StatDot({ color }: { color: string }) {
  return (
    <div className="relative flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-white/40">
      <span
        className="absolute m-auto inline-block h-2.5 w-2.5 rounded-full"
        style={{ backgroundColor: color }}
      />
    </div>
  );
}

/**
 * Same structure as EPCCRM's DashboardSummaryBanner — gradient hero,
 * glassmorphic stat cluster with coloured dots — Multizoo's jade gradient
 * instead of Harper's purple, and no background photo asset.
 */
export default function SummaryBanner({
  title,
  subtitle,
  stats,
  action,
}: SummaryBannerProps) {
  return (
    <div
      className="relative w-full overflow-hidden rounded-xl bg-cover bg-center px-5 py-5 xl:px-8 xl:py-7"
      style={{
        backgroundImage:
          'linear-gradient(115deg, #0F4A37 0%, #1B6E52 45%, #16201B 100%)',
      }}
    >
      <div className="absolute inset-0 bg-black/10" aria-hidden="true" />

      <div className="relative flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <p className="text-xl font-extrabold text-white xl:text-3xl">
            {title}
          </p>
          {subtitle && (
            <p className="mt-1 text-sm text-white/80">{subtitle}</p>
          )}
        </div>

        <div className="flex items-center gap-3">
          {stats?.length ? (
            <div className="flex flex-wrap gap-2 rounded-xl border border-white/12 bg-white/10 p-2 backdrop-blur-md xl:flex-nowrap xl:gap-5.5 xl:px-4">
              {stats.map((item, index) => (
                <Fragment key={`${item.title}-${index}`}>
                  {index > 0 && (
                    <div
                      className="hidden h-5 w-px shrink-0 bg-white/30 xl:block"
                      aria-hidden="true"
                    />
                  )}
                  <div className="flex min-w-0 items-center gap-2">
                    <StatDot color={item.color} />
                    <p className="whitespace-nowrap text-xs text-white/80 xl:text-sm">
                      {item.title}
                    </p>
                    <p className="text-sm font-bold text-white xl:text-base">
                      {item.count}
                    </p>
                  </div>
                </Fragment>
              ))}
            </div>
          ) : null}
          {action}
        </div>
      </div>
    </div>
  );
}
