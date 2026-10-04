import { useEffect, useRef, useState } from 'react';
import type { Note, NoteInput, Project } from '../../shared/types';
import { api, errorMessage } from './api';
import { NoteForm } from './NoteForm';
import { NoteItem } from './NoteItem';
import type { DraftChange } from './useDraftGuard';

export function ProjectView({ userId, project, projects, busy, onBusyChange, onDirtyChange, onNoteCountChange, onNoteMoved, onEdit }: {
  userId: string; project: Project; projects: Project[]; busy: boolean; onBusyChange: (busy: boolean) => void;
  onNoteMoved: (sourceProjectId: string, targetProjectId: string, sourceCount: number) => void;
  onDirtyChange: DraftChange; onNoteCountChange: (projectId: string, count: number) => void; onEdit: () => void;
}) {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [moveNotice, setMoveNotice] = useState('');
  const moveNoticeRef = useRef<HTMLDivElement>(null);
  const [attempt, setAttempt] = useState(0);
  const path = `/users/${userId}/projects/${project.id}`;
  const destinations = projects.filter((item) => item.id !== project.id);

  useEffect(() => {
    if (moveNotice) moveNoticeRef.current?.focus();
  }, [moveNotice]);

  useEffect(() => {
    const controller = new AbortController();
    setError('');
    void api<{ project: Project; notes: Note[] }>(path, { signal: controller.signal })
      .then((data) => { setNotes(data.notes); onNoteCountChange(data.project.id, data.notes.length); })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(errorMessage(reason)); });
    return () => controller.abort();
  }, [path, attempt, onNoteCountChange]);

  async function addNote(input: NoteInput) {
    if (!notes) return;
    setMoveNotice('');
    onBusyChange(true);
    try {
      const { note } = await api<{ note: Note }>(`${path}/notes`, { method: 'POST', body: JSON.stringify(input) });
      setNotes([note, ...notes]);
      onNoteCountChange(project.id, notes.length + 1);
      setStatus('Note added.');
    } finally { onBusyChange(false); }
  }

  async function updateNote(id: string, input: NoteInput) {
    setMoveNotice('');
    onBusyChange(true);
    try {
      const { note } = await api<{ note: Note }>(`${path}/notes/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
      setNotes((current) => current?.map((item) => item.id === id ? note : item) ?? null);
      setStatus('Changes saved.');
    } finally { onBusyChange(false); }
  }

  async function deleteNote(id: string) {
    if (!notes) return;
    setMoveNotice('');
    onBusyChange(true);
    try {
      await api<void>(`${path}/notes/${id}`, { method: 'DELETE' });
      setNotes(notes.filter((note) => note.id !== id));
      onNoteCountChange(project.id, notes.length - 1);
      setStatus('Note deleted.');
    } finally { onBusyChange(false); }
  }

  async function moveNote(id: string, targetProjectId: string) {
    if (!notes) return;
    onBusyChange(true);
    setMoveNotice('');
    try {
      const { note } = await api<{ note: Note }>(`${path}/notes/${id}/move`, {
        method: 'POST', body: JSON.stringify({ targetProjectId }),
      });
      const remaining = notes.filter((item) => item.id !== note.id);
      setNotes(remaining);
      onNoteMoved(project.id, note.projectId, remaining.length);
      const targetName = destinations.find((item) => item.id === note.projectId)?.name ?? 'another project';
      setStatus('');
      setMoveNotice(`Moved to ${targetName}.`);
    } finally { onBusyChange(false); }
  }

  return <section aria-labelledby="project-title">
    <header className="page-heading project-heading"><div><h1 id="project-title">{project.name}</h1>{project.description ? <p className="subtitle">{project.description}</p> : null}</div>
      <button className="small-button" onClick={onEdit} disabled={busy}>Edit project</button>
    </header>
    {error ? <div className="error-panel" role="alert"><p>{error}</p><button onClick={() => setAttempt((value) => value + 1)}>Try again</button></div>
      : notes === null ? <p role="status">Opening your notes…</p> : <>
        <NoteForm id="new-note" disabled={busy} onSave={addNote} onDirtyChange={onDirtyChange} />
        <section className="notes" aria-labelledby="notes-title">
          <div ref={moveNoticeRef} className="move-notice" role="status" tabIndex={-1}>{moveNotice}</div>
          <div className="notes-heading"><h2 id="notes-title">Notes <span>{notes.length}</span></h2><span className="sort-label">Newest first</span></div>
          {notes.length ? <ul className="note-list">{notes.map((note) => <NoteItem key={note.id} note={note} destinations={destinations} busy={busy} onUpdate={updateNote} onDelete={deleteNote} onMove={moveNote} onDirtyChange={onDirtyChange} />)}</ul>
            : <div className="empty-notes"><p>No notes yet.</p><p>Start with whatever’s on your mind.</p></div>}
        </section>
      </>}
    <div className="sr-only" role="status" aria-live="polite">{status}</div>
  </section>;
}
