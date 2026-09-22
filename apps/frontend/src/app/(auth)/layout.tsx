/** Copied 1:1 from EPCCRM's (auth)/layout.tsx. */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="h-dvh overflow-hidden bg-gray-200 p-4">{children}</div>;
}
