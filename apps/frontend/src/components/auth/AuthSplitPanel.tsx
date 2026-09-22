import Image from 'next/image';
import type { ReactNode } from 'react';
import Logo from '../ui/Logo';

/**
 * Copied 1:1 from EPCCRM's LoginPageClient / set-password page — the glass
 * outer frame, white left panel with the logo pinned top-left, and the
 * right panel using the same background photo and mockup image. Only the
 * headline/subtitle copy is Multizoo's own (EPCCRM's talks about "leads").
 */
export default function AuthSplitPanel({ children }: { children: ReactNode }) {
  return (
    <div className="grid h-full min-h-0 flex-1 grid-cols-1 gap-3 rounded-3xl xl:grid-cols-2 xl:rounded-4xl xl:border xl:border-white xl:bg-white/40 xl:p-3">
      <div className="xl:p-8 p-4 flex flex-col relative items-center justify-center w-full bg-white rounded-[20px]">
        <Logo size={64} className="md:absolute mb-4 top-2 left-2 md:left-4 md:top-4" />
        <div className="md:flex-1 max-w-117 w-full flex items-center justify-center flex-col">
          {children}
        </div>
      </div>

      <div className="bg-[url('/login-bg.jpg')] bg-center bg-no-repeat rounded-3xl hidden md:flex items-center justify-center backdrop-blur-3xl relative">
        <div className="flex-1 flex items-center space-y-8 md:space-y-12 px-4 justify-center flex-col">
          <div className="max-w-160 w-full space-y-3">
            <h2 className="text-white font-bold text-4xl md:text-[36px] text-center">
              One login, every company
            </h2>
            <h3 className="text-center text-white text-base md:text-lg">
              Manage roles, permissions and users across every Multizoo Group
              entity from a single, secure account.
            </h3>
          </div>

          <div className="md:px-10">
            <Image alt="" src="/login-mockup.png" width={520} height={360} />
          </div>
        </div>
      </div>
    </div>
  );
}
