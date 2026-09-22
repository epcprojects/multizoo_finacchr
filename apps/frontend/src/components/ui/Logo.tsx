import Image from 'next/image';

type LogoProps = {
  size?: number;
  className?: string;
};

/** Same circular brand mark used across Zarrar.pk's products, incl. EPCCRM. */
export default function Logo({ size = 44, className }: LogoProps) {
  return (
    <Image
      src="/logo.png"
      alt="Zarrar.pk logo"
      width={size}
      height={size}
      className={`shrink-0 rounded-full ${className ?? ''}`}
      priority
    />
  );
}
