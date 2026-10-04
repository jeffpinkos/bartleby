import { useState } from 'react';
import type { Note, NoteInput } from '../../shared/types';
import { errorMessage } from './api';
import { NoteForm } from './NoteForm';
import type { DraftChange } from './useDraftGuard';

const dateFormatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

export function NoteItem({ note, busy, onUpdate, onDelete, onDirtyChange }: {
  note: Note; busy: boolean; onUpdate: (id: string, input: NoteInput) => Promise<void>;
  onDelete: (id: string) => Promise<void>; onDirtyChange: DraftChange;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');

  if (editing) return <li className="note-item editing">
    <NoteForm id={note.id} initial={note} disabled={busy} onDirtyChange={onDirtyChange}
      onCancel={() => setEditing(false)} onSave={async (input) => { await onUpdate(note.id, input); setEditing(false); }} />
  </li>;

  return <li className="note-item"><article>
    <div className="note-heading"><div>{note.title ? <h3>{note.title}</h3> : null}
      <time dateTime={note.createdAt} title={`Last saved ${new Date(note.updatedAt).toLocaleString()}`}>{dateFormatter.format(new Date(note.createdAt))}</time>
    </div><div className="note-actions">
      <button className="text-button" onClick={() => { setEditing(true); setConfirming(false); }} disabled={busy}>Edit</button>
      <button className="text-button" onClick={() => { setConfirming(true); setError(''); }} disabled={busy}>Delete</button>
    </div></div>
    <p className="note-body">{note.body}</p>
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
