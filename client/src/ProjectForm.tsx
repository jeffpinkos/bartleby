import { useState, type FormEvent } from 'react';
import type { Project } from '../../shared/types';
import { api, errorMessage } from './api';
import { useDraftGuard, type DraftChange } from './useDraftGuard';

export function ProjectForm({ userId, isFirst, onCreated, onCancel, onDirtyChange, onBusyChange }: {
  userId: string; isFirst: boolean; onCreated: (project: Project) => void; onCancel: () => void;
  onDirtyChange: DraftChange; onBusyChange: (busy: boolean) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  useDraftGuard('project', !!(name || description), onDirtyChange);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || pending) return;
    setPending(true);
    onBusyChange(true);
    setError('');
    try {
      const { project } = await api<{ project: Project }>(`/users/${userId}/projects`, { method: 'POST', body: JSON.stringify({ name, description }) });
      onCreated(project);
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setPending(false); onBusyChange(false); }
  }

  return <section>
    <header className="page-heading"><h1>{isFirst ? 'Your first project.' : 'A new project.'}</h1><p className="subtitle">Give your ideas somewhere to land.</p></header>
    <form className="setup-form project-form" onSubmit={(event) => void submit(event)}>
      <label htmlFor="project-name">Project name</label>
      <input id="project-name" autoFocus required maxLength={200} placeholder="Field notes" value={name} onChange={(event) => setName(event.target.value)} disabled={pending} />
      <label htmlFor="project-description">Description <span className="muted">(optional)</span></label>
      <textarea id="project-description" rows={3} maxLength={2000} placeholder="A place for the things you notice." value={description} onChange={(event) => setDescription(event.target.value)} disabled={pending} />
      {error ? <p className="error" role="alert">{error}</p> : null}
      <div className="form-actions"><button className="primary" disabled={pending || !name.trim()}>{pending ? 'Creating…' : 'Create project'}</button>
        {!isFirst ? <button type="button" onClick={onCancel} disabled={pending}>Cancel</button> : null}</div>
    </form>
  </section>;
}
