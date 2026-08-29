const LINKS = [
  { label: 'Fiverr', href: 'https://www.fiverr.com/techtig' },
  { label: 'Upwork', href: 'https://www.upwork.com/freelancers/~techtig' },
  { label: 'Freelancer', href: 'https://www.freelancer.com/u/techtig' },
  { label: 'Facebook', href: 'https://www.facebook.com/techtig' },
  { label: 'Instagram', href: 'https://www.instagram.com/techtig9' },
];

export function About() {
  return (
    <section id="about" className="border-t border-line bg-canvas-alt py-24">
      <div className="mx-auto max-w-3xl px-6 text-center reveal">
        <span className="section-eyebrow mx-auto">About us</span>
        <h2 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">Built by Techtig.</h2>
        <p className="mt-6 text-lg leading-relaxed text-ink-soft">
          Techtig — An AI development agency that builds intelligent, scalable, and modern digital
          solutions. We specialize in AI-powered websites, SaaS platforms, AI chatbots, business
          automation, custom web applications, eCommerce solutions, UI/UX design, and digital
          marketing — helping businesses innovate, automate, and grow.
        </p>
        <p className="mt-4 text-sm text-ink-faint">owbrand is a product built and maintained by Techtig.</p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          {LINKS.map((link) => (
            <a
              key={link.label}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border border-line bg-white px-4 py-2 text-sm font-medium text-ink transition-colors hover:border-coral-400 hover:text-coral-600"
            >
              {link.label}
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
