import Link from "next/link";
import { Sparkles } from "lucide-react";
import { UserMenu } from "@/components/auth/UserMenu";

export default function Home() {
  return (
    <main className="marketing-shell">
      <nav className="landing-nav">
        <div className="brand">
          <Sparkles size={18} />
          <span>Build123d CAD Agent</span>
        </div>
        <div className="nav-actions">
          <Link href="/sign-in">Sign in</Link>
          <UserMenu />
        </div>
      </nav>
      <section className="product-hero">
        <p className="hero-kicker">AI CAD SaaS foundation</p>
        <h1>Generate and revise validated CAD projects.</h1>
        <p>
          Internal teams can create mounting plates and L brackets, keep revision history, download artifact packages,
          and review usage in a controlled staging environment.
        </p>
        <div className="hero-actions">
          <Link className="primary-link" href="/app">
            Open dashboard
          </Link>
          <Link className="secondary-link" href="/sign-up">
            Request access
          </Link>
        </div>
      </section>
    </main>
  );
}
