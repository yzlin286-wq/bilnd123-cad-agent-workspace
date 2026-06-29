import Link from "next/link";
import { AlertTriangle, ArrowRight, Box, FileArchive, Gauge, History, Plus, Upload } from "lucide-react";
import type { ReactNode } from "react";
import { UserMenu } from "@/components/auth/UserMenu";
import { templatesByCategory } from "@/lib/cad/templates";
import { getAdminSummary } from "@/lib/server/admin-summary";
import { appRouteAccess, getPageAuthContext, signInRedirectPath } from "@/lib/server/auth";
import { listProjects, recentArtifacts } from "@/lib/server/project-store";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function AppDashboardPage() {
  const auth = await getPageAuthContext();
  if (appRouteAccess(auth) === "sign_in") {
    redirect(signInRedirectPath("/app"));
  }
  const [projects, artifacts, summary] = await Promise.all([
    listProjects({ auth, limit: 8 }),
    recentArtifacts({ auth, limit: 6 }),
    getAdminSummary(),
  ]);
  const templateGroups = templatesByCategory();

  return (
    <main className="saas-shell">
      <header className="saas-topbar">
        <div>
          <p className="microcopy">CAD Agent</p>
          <h1>Projects dashboard</h1>
        </div>
        <UserMenu />
      </header>

      <section className="dashboard-hero">
        <div>
          <p className="microcopy">Internal alpha</p>
          <h2>Start a validated CAD revision loop.</h2>
          <p>Generate a supported template, revise it conversationally, and keep the project history for review.</p>
        </div>
        <Link className="primary-link" href="/app/workspace">
          <Plus size={18} />
          New CAD
        </Link>
      </section>

      {Object.entries(templateGroups).map(([category, templates]) => (
        <section className="template-section" key={category}>
          <div className="template-section-header">
            <p className="microcopy">{category}</p>
            <h2>{templates.length} supported templates</h2>
          </div>
          <div className="template-grid">
            {templates.map((template) => (
              <TemplateCard
                icon={template.category === "Rotational" ? <Gauge size={20} /> : <Box size={20} />}
                title={template.title}
                description={template.description}
                href={`/app/workspace?template=${encodeURIComponent(template.id)}`}
                key={template.id}
              />
            ))}
          </div>
        </section>
      ))}

      <section className="template-grid">
        <article className="template-card disabled">
          <Upload size={20} />
          <h3>Upload Sketch</h3>
          <p>Coming soon. Image-to-CAD is not enabled for this alpha.</p>
          <span>Coming soon</span>
        </article>
      </section>

      <section className="dashboard-grid">
        <Panel title="Recent Projects" action={<Link href="/app/projects">View all</Link>}>
          {projects.length ? (
            <div className="project-list">
              {projects.map((project) => (
                <Link href={`/app/workspace?projectId=${encodeURIComponent(project.id)}`} key={project.id}>
                  <strong>{project.title}</strong>
                  <span>
                    {project.partType || "CAD"} - {project.revisionCount} revision{project.revisionCount === 1 ? "" : "s"}
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState icon={<History size={20} />} text="No projects yet. Start with a supported template." />
          )}
        </Panel>

        <Panel title="Recent Artifacts">
          {artifacts.length ? (
            <div className="artifact-list compact">
              {artifacts.map((artifact) => (
                <a href={artifact.url} key={artifact.id}>
                  <FileArchive size={16} />
                  <span>{artifact.name}</span>
                  <small>{artifact.projectTitle}</small>
                </a>
              ))}
            </div>
          ) : (
            <EmptyState icon={<FileArchive size={20} />} text="Artifacts appear after the CAD runner completes a revision." />
          )}
        </Panel>

        <Panel title="Usage Summary">
          <div className="usage-grid">
            <Metric label="Runs" value={summary.totalRuns} />
            <Metric label="Projects" value={summary.totalProjects} />
            <Metric label="P95" value={`${summary.p95DurationMs} ms`} />
            <Metric label="Failures" value={summary.failureCount} />
          </div>
          <p className="panel-note">
            Data layer: {summary.dataLayer.mode === "postgres" ? "Postgres" : "JSON dev fallback"}
          </p>
        </Panel>

        <Panel title="Alpha Health">
          <div className={summary.newUnexpectedFailures ? "health-badge warn" : "health-badge ok"}>
            <AlertTriangle size={18} />
            <div>
              <strong>{summary.newUnexpectedFailures ? "Needs triage" : "Ready for controlled trial"}</strong>
              <span>{summary.newUnexpectedFailures} new unexpected failures</span>
            </div>
          </div>
          <p className="panel-note">
            Supported template catalog has 20 deterministic build123d templates. Upload sketch and anonymous arbitrary CAD are not enabled.
          </p>
        </Panel>
      </section>
    </main>
  );
}

function TemplateCard({
  icon,
  title,
  description,
  href,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  href: string;
}) {
  return (
    <Link className="template-card" href={href}>
      {icon}
      <h3>{title}</h3>
      <p>{description}</p>
      <span>
        Open <ArrowRight size={15} />
      </span>
    </Link>
  );
}

function Panel({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <article className="dashboard-panel">
      <header>
        <h2>{title}</h2>
        {action}
      </header>
      {children}
    </article>
  );
}

function EmptyState({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className="dashboard-empty">
      {icon}
      <span>{text}</span>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}
