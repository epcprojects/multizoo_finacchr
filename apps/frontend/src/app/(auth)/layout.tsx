export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <span className="text-2xl font-extrabold text-ink">
            Multizoo Ledger
          </span>
        </div>
        <div className="bg-surface border border-line rounded-xl shadow-sm p-8">
          {children}
        </div>
      </div>
    </div>
  );
}
