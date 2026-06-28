import Link from "next/link";
import { Search } from "lucide-react";
import { UserMenu } from "@/components/auth/UserMenu";
import { appRouteAccess, getPageAuthContext } from "@/lib/server/auth";
import { listProjects } from "@/lib/server/project-store";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const auth = await getPageAuthContext();
  if (appRouteAccess(auth) === "sign_in") {
    redirect("/sign-in?redirect_url=/app/projects");
  }
  const projects = await listProjects({ auth, limit: 50 });

  return (
    <main className="saas-shell">
      <header className="saas-topbar">
        <div>
          <p className="microcopy">Projects</p>
          <h1>Recent CAD projects</h1>
        </div>
        <UserMenu />
      </header>
      <section className="projects-toolbar">
        <div>
          <Search size={17} />
          <span>Sorted by most recent update</span>
        </div>
        <Link className="primary-link" href="/app/workspace">
          New CAD
        </Link>
      </section>
      <section className="projects-table">
        {projects.length ? (
          projects.map((project) => (
            <Link href={`/app/workspace?projectId=${encodeURIComponent(project.id)}`} key={project.id}>
              <strong>{project.title}</strong>
              <span>{project.partType || "CAD project"}</span>
              <span>
                {project.revisionCount} rev{project.revisionCount === 1 ? "" : "s"}
              </span>
              <time>{new Date(project.updatedAt).toLocaleString()}</time>
            </Link>
          ))
        ) : (
          <div className="dashboard-empty">No projects yet.</div>
        )}
      </section>
    </main>
  );
}
