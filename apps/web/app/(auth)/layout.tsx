import type { ReactNode } from 'react';

// Sign-in screens (doc 52 section 9; owner's prototype): a full-bleed food photo under a dark overlay, the brand message
// on the left (large screens only, decorative) and the white sign-in card on the right. No shell; one main landmark.
// The photo is a demo image until the owner supplies the original (public/brand/README.md).
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main
      id="main"
      className="relative min-h-screen bg-sidebar-from bg-cover bg-center"
      style={{ backgroundImage: 'url(/brand/login-hero.jpg)' }}
    >
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/70 to-black/55"
      />
      <div className="relative mx-auto grid min-h-screen max-w-7xl items-center gap-10 px-4 py-10 sm:px-8 lg:grid-cols-[1.15fr_1fr] lg:px-12">
        <div
          aria-hidden
          className="hidden flex-col justify-between self-stretch py-6 text-white lg:flex"
        >
          <span
            className="block h-16 w-28 rounded-2xl bg-white bg-center bg-no-repeat shadow-lg"
            style={{ backgroundImage: 'url(/brand/zoauro-logo.jpeg)', backgroundSize: '150% auto' }}
          />
          <div>
            <p className="text-5xl leading-[1.05] font-extrabold tracking-tight xl:text-6xl">
              One platform.
              <br />
              Every service.
              <br />
              <span className="text-[#ff7a45]">Complete control.</span>
            </p>
            <p className="mt-6 max-w-md text-lg text-white/80">
              Manage restaurants, home food, delivery operations and customers across every zone.
            </p>
          </div>
          <p className="border-l-2 border-[#ff7a45] pl-3 text-sm text-white/70">
            ZOAURO · a smarter food delivery platform by GloAro, for every zone.
          </p>
        </div>
        <div className="flex justify-center lg:justify-end">{children}</div>
      </div>
    </main>
  );
}
