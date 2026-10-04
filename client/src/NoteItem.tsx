import { useEffect, useRef, useState } from 'react';
import type { Note, NoteInput, Project } from '../../shared/types';
import { errorMessage } from './api';
import { NoteForm } from './NoteForm';
import { MoveNoteForm } from './MoveNoteForm';
import type { DraftChange } from './useDraftGuard';

const dateFormatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

export function NoteItem({ note, focused, destinations, busy, onUpdate, onDelete, onMove, onDirtyChange }: {
  note: Note; destinations: Project[]; busy: boolean; onUpdate: (id: string, input: NoteInput) => Promise<void>;
  onMove: (id: string, targetProjectId: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>; onDirtyChange: DraftChange;
  focused: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [moving, setMoving] = useState(false);
  const moveButton = useRef<HTMLButtonElement>(null);
  const [error, setError] = useState('');
  const article = useRef<HTMLElement>(null);

  useEffect(() => {
    if (focused) {
      article.current?.focus({ preventScroll: true });
      article.current?.scrollIntoView({ block: 'center' });
    }
  }, [focused]);

  if (editing) return <li className="note-item editing">
    <NoteForm id={note.id} initial={note} disabled={busy} onDirtyChange={onDirtyChange}
      onCancel={() => setEditing(false)} onSave={async (input) => { await onUpdate(note.id, input); setEditing(false); }} />
  </li>;

  return <li className={`note-item${focused ? ' located-note' : ''}`}><article ref={article} tabIndex={-1} aria-label={note.title || 'Untitled note'}>
    <div className="note-heading"><div>{note.title ? <h3>{note.title}</h3> : null}
      <time dateTime={note.createdAt} title={`Last saved ${new Date(note.updatedAt).toLocaleString()}`}>{dateFormatter.format(new Date(note.createdAt))}</time>
    </div><div className="note-actions">
      <button className="text-button" onClick={() => { setEditing(true); setConfirming(false); setMoving(false); }} disabled={busy}>Edit</button>
      <button ref={moveButton} className="text-button" aria-expanded={moving} onClick={() => { setMoving((current) => !current); setConfirming(false); setError(''); }} disabled={busy}>Move to project…</button>
      <button className="text-button" onClick={() => { setConfirming(true); setMoving(false); setError(''); }} disabled={busy}>Delete</button>
    </div></div>
    <p className="note-body">{note.body}</p>
    {moving ? <MoveNoteForm destinations={destinations} busy={busy} onMove={(targetId) => onMove(note.id, targetId)} onCancel={() => { setMoving(false); moveButton.current?.focus(); }} /> : null}
    {confirming ? <div className="delete-confirmation" role="group" aria-label="Confirm deletion">
      <span>Delete this note permanently?</span><div className="form-actions">
        <button className="small-button" onClick={() => setConfirming(false)} disabled={busy}>Keep note</button>
        <button className="danger small-button" disabled={busy} onClick={() => {
          void onDelete(note.id).catch((reason: unknown) => setError(errorMessage(reason)));
        }}>{busy ? 'Deleting…' : 'Delete note'}</button>
      </div>
    </div> : null}
    {error ? <p className="error" role="alert">{error}</p> : null}
  </article></li>;
}
