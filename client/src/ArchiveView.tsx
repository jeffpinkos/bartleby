import type { Project } from "../../shared/types";

export function ArchiveView({
  projects,
  busy,
  onRestore,
}: {
  projects: Project[];
  busy: boolean;
  onRestore: (project: Project) => void;
}) {
  return (
    <section aria-labelledby="archive-title">
      <header className="page-heading">
        <h1 id="archive-title">Archived projects</h1>
          <p className="subtitle">
            Projects here are hidden from your workspace. Restore one any time.
          </p>
      </header>
      {projects.length ? (
        <ul className="archive-list">
          {projects.map((project) => (
            <li key={project.id}>
              <div className="archive-project">
                <div>
                  <h2>{project.name}</h2>
                  {project.description ? <p>{project.description}</p> : null}
                  <span className="note-count">{project.noteCount} notes</span>
                </div>
                <button
                  className="small-button"
                  disabled={busy}
                  onClick={() => onRestore(project)}
                >
                  Restore
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="empty-notes">
          <p>No archived projects.</p>
          <p>Archived projects will appear here.</p>
        </div>
      )}
    </section>
  );
}
