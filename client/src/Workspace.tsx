import { useCallback, useEffect, useState } from 'react';
import type { Project, User } from '../../shared/types';
import { api, errorMessage, readPreference, savePreference } from './api';
import { Sidebar } from './Sidebar';
import { ProjectForm } from './ProjectForm';
import { ProjectView } from './ProjectView';
import { useConfirmDiscard } from './DiscardDialog';

export function Workspace({ user, onSwitchUser }: { user: User; onSwitchUser: () => void }) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<'view' | 'create' | 'edit'>('view');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [dirtyForms, setDirtyForms] = useState(() => new Set<string>());
  const { confirmDiscard, dialog } = useConfirmDiscard();

  const onDirtyChange = useCallback((id: string, dirty: boolean) => {
    setDirtyForms((current) => {
      if (current.has(id) === dirty) return current;
      const next = new Set(current);
      if (dirty) next.add(id); else next.delete(id);
      return next;
    });
  }, []);

  const onNoteCountChange = useCallback((projectId: string, count: number) => {
    setProjects((current) => current?.map((project) => project.id === projectId ? { ...project, noteCount: count } : project) ?? null);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setError('');
    void api<{ projects: Project[] }>(`/users/${user.id}/projects`, { signal: controller.signal })
      .then(({ projects: items }) => {
        setProjects(items);
        const remembered = readPreference(`project.${user.id}`);
        setSelectedId(items.find((project) => project.id === remembered)?.id ?? items[0]?.id ?? null);
        setMode(items.length === 0 ? 'create' : 'view');
      }).catch((reason: unknown) => { if (!controller.signal.aborted) setError(errorMessage(reason)); });
    return () => controller.abort();
  }, [user.id, attempt]);

  function navigate(action: () => void) {
    if (!busy) confirmDiscard(dirtyForms.size > 0, action);
  }
  function selectProject(id: string) {
    if (id === selectedId && mode === 'view') return;
    navigate(() => {
      setSelectedId(id);
      savePreference(`project.${user.id}`, id);
      setMode('view');
    });
  }
  const selected = projects?.find((project) => project.id === selectedId);

  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to notes</a>
    <Sidebar user={user} projects={projects ?? []} selectedId={mode === 'create' ? null : selectedId} disabled={busy || !projects}
      onSelect={selectProject} onNew={() => { if (mode !== 'create') navigate(() => setMode('create')); }}
      onSwitchUser={() => navigate(onSwitchUser)} />
    <main className="workspace" id="main-content">
      {error ? <div className="error-panel" role="alert"><h1>Couldn’t open your projects.</h1><p>{error}</p><button onClick={() => setAttempt((value) => value + 1)}>Try again</button></div>
        : !projects ? <p role="status">Opening your projects…</p>
          : mode !== 'view' ? <ProjectForm key={mode === 'edit' ? selectedId : 'new'} userId={user.id} isFirst={!projects.length} initial={mode === 'edit' ? selected : undefined} onDirtyChange={onDirtyChange} onBusyChange={setBusy}
            onCancel={() => navigate(() => setMode('view'))}
            onSaved={(project) => {
              setProjects((current) => current?.some((item) => item.id === project.id)
                ? current.map((item) => item.id === project.id ? project : item)
                : [...current ?? [], project]);
              setSelectedId(project.id);
              savePreference(`project.${user.id}`, project.id);
              setMode('view');
            }} />
            : selected ? <ProjectView key={selected.id} userId={user.id} project={selected} busy={busy} onBusyChange={setBusy} onDirtyChange={onDirtyChange} onNoteCountChange={onNoteCountChange} onEdit={() => navigate(() => setMode('edit'))} /> : null}
    </main>
    {dialog}
  </div>;
}
