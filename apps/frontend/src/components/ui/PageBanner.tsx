'use client';

import Image from 'next/image';
import { Fragment } from 'react';

type BannerStat = { title: string; count: number | string; color: string };

type PageBannerProps = {
  imageSrc: string;
  imageAlt?: string;
  title: string;
  stats?: BannerStat[];
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
 * Copied 1:1 from EPCCRM's DashboardSummaryBanner — same 5-stop gradient,
 * same background photo, same glass stat cluster. Used both as the
 * Dashboard hero and as the compact per-page banner (Roles, Users, …).
 */
export default function PageBanner({
  imageSrc,
  imageAlt = '',
  title,
  stats,
}: PageBannerProps) {
  return (
    <div
      style={{
        backgroundImage: `
      url('/dashboard-bg.jpg'),
      linear-gradient(
        to right,
        #335C94 0%,
        #665932 25%,
        #7B398E 50%,
        #003F89 75%,
        #070922 100%
      )
    `,
      }}
      className="relative w-full overflow-hidden rounded-xl bg-cover bg-center bg-no-repeat px-4 py-4 xl:px-7.5 xl:py-6"
    >
      <div className="absolute inset-0 bg-black/30" aria-hidden="true" />

      <div className="relative flex w-full flex-col gap-2 xl:flex-row xl:items-center xl:gap-4">
        <div className="relative flex min-w-0 items-center gap-3 xl:contents">
          <Image
            alt={imageAlt}
            src={imageSrc}
            width={48}
            height={48}
            className="h-10 w-10 shrink-0 rounded-full backdrop-blur-3xl drop-shadow xl:h-12 xl:w-12"
          />
          <p className="min-w-0 truncate text-xl xl:text-2xl text-white xl:hidden">
            {title}
          </p>
        </div>

        <div className="relative flex min-w-0 w-full flex-1 flex-col gap-3 md:flex-row xl:flex-row xl:items-center xl:justify-between xl:gap-4">
          <p className="hidden text-[32px] text-white xl:block">{title}</p>

          {stats?.length ? (
            <div className="grid grid-cols-2 gap-2 sm:w-fit rounded-xl border border-white/12 bg-white/10 p-2 backdrop-blur-3xl drop-shadow-[0_14px_44px_0_rgb(0_0_0/0.45)] xl:flex xl:max-w-full xl:flex-row xl:items-center xl:gap-5.5 xl:px-4">
              {stats.map((item, index) => (
                <Fragment key={`${item.title}-${index}`}>
                  {index > 0 ? (
                    <div
                      className="hidden h-5.25 w-0.5 shrink-0 bg-linear-to-b from-white/0 via-white/80 to-white/0 xl:block"
                      aria-hidden="true"
                    />
                  ) : null}
                  <div className="flex min-w-0 items-center justify-between gap-2 xl:shrink-0 xl:justify-start xl:gap-4">
                    <div className="flex min-w-0 items-center gap-2">
                      <StatDot color={item.color} />
                      <p className="truncate text-xs text-gray-200 sm:text-sm xl:whitespace-nowrap 2xl:text-base">
                        {item.title}
                      </p>
                    </div>
                    <p className="shrink-0 whitespace-nowrap text-sm font-bold text-white sm:text-base 2xl:text-lg">
                      {item.count}
                    </p>
                  </div>
                </Fragment>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
