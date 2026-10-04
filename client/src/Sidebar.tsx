import type { Project, User } from '../../shared/types';

function Plus() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M12 4v16M4 12h16" /></svg>;
}

export function Sidebar({ user, projects, selectedId, disabled, onSelect, onNew, onSwitchUser }: {
  user: User; projects: Project[]; selectedId: string | null; disabled: boolean;
  onSelect: (id: string) => void; onNew: () => void; onSwitchUser: () => void;
}) {
  return <aside className="sidebar">
    <div className="wordmark">bartleby.</div>
    <nav aria-label="Projects" className="project-navigation">
      <div className="nav-heading"><span>Projects</span><button className="icon-button" aria-label="Create a project" onClick={onNew} disabled={disabled}><Plus /></button></div>
      <ul className="project-list">{projects.map((project) => <li key={project.id}>
        <button onClick={() => onSelect(project.id)} aria-current={selectedId === project.id ? 'page' : undefined} disabled={disabled}>
          <span>{project.name}</span><span className="note-count">{project.noteCount}</span>
        </button>
      </li>)}</ul>
      <label className="sr-only" htmlFor="mobile-project">Project</label>
      <select id="mobile-project" className="mobile-project" value={selectedId ?? ''} disabled={disabled || !projects.length} onChange={(event) => onSelect(event.target.value)}>
        <option value="" disabled>{projects.length ? 'Choose a project' : 'No projects yet'}</option>
        {projects.map((project) => <option value={project.id} key={project.id}>{project.name} ({project.noteCount})</option>)}
      </select>
      <button className="new-project text-button" onClick={onNew} disabled={disabled}><Plus />New project</button>
    </nav>
    <div className="profile"><span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span><span className="profile-name">{user.name}</span>
      <button className="small-button" onClick={onSwitchUser} disabled={disabled}>Switch user</button>
    </div>
  </aside>;
}
