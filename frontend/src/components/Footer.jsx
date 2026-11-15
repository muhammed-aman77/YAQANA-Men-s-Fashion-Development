import { Mail } from 'lucide-react';

export default function Footer() {
  return (
    <footer className="border-t border-xora-taupe/30 bg-xora-sand/60 text-xora-charcoal">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="py-8 text-center sm:py-10">
          <p className="font-serif text-2xl font-light uppercase tracking-[0.24em] sm:text-3xl">YAQANA</p>
          <p className="mt-2 text-[10px] font-medium uppercase tracking-[0.3em] text-xora-taupe-dark">Modern Menswear</p>
        </div>

        <div className="h-px w-full bg-xora-taupe/40" />

        <div className="flex flex-col items-center gap-5 py-5 text-center sm:flex-row sm:justify-between sm:gap-6 sm:py-6 sm:text-left">
          <nav aria-label="YAQANA contact links" className="flex flex-col items-center gap-4 sm:flex-row sm:gap-5">
            <a
              href="https://www.instagram.com/yaqana_apparel/"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 text-xs text-xora-taupe-dark transition-colors hover:text-xora-charcoal sm:text-sm"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="3" y="3" width="18" height="18" rx="5" />
                <circle cx="12" cy="12" r="4" />
                <circle cx="17.5" cy="6.5" r="0.75" fill="currentColor" stroke="none" />
              </svg>
              <span>@yaqana_apparel</span>
            </a>

            <span aria-hidden="true" className="hidden h-4 w-px bg-xora-taupe/60 sm:block" />

            <a
              href="mailto:apparelyaqana@gmail.com"
              className="inline-flex items-center gap-2 text-xs text-xora-taupe-dark transition-colors hover:text-xora-charcoal sm:text-sm"
            >
              <Mail aria-hidden="true" className="h-4 w-4" strokeWidth={1.5} />
              <span>apparelyaqana@gmail.com</span>
            </a>
          </nav>

          <p className="text-[10px] uppercase tracking-[0.12em] text-xora-taupe-dark sm:text-[11px]">
            © 2026 YAQANA. All Rights Reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
