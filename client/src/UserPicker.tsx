import { useState, type FormEvent } from 'react';
import type { User } from '../../shared/types';
import { api, errorMessage } from './api';
import { useDraftGuard } from './useDraftGuard';
import { useConfirmDiscard } from './DiscardDialog';

export function UserPicker({ users, onSelect, onCreate }: { users: User[]; onSelect: (user: User) => void; onCreate: (user: User) => void }) {
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const { confirmDiscard, dialog } = useConfirmDiscard();
  useDraftGuard('user', name.length > 0);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || pending) return;
    setPending(true);
    setError('');
    try {
      const { user } = await api<{ user: User }>('/users', { method: 'POST', body: JSON.stringify({ name }) });
      onCreate(user);
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setPending(false); }
  }

  return <section className="welcome-content">
    <h1>{users.length ? 'Welcome back.' : 'Room for your ideas.'}</h1>
    <p className="subtitle">{users.length ? 'Choose a user to open their projects.' : 'Your projects, your notes, a place to begin.'}</p>
    {users.length > 0 ? <ul className="user-list">{users.map((user) => <li key={user.id}>
      <button disabled={pending} onClick={() => {
        confirmDiscard(!!name, () => onSelect(user));
      }}><span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span><span>{user.name}</span><span aria-hidden="true">↗</span></button>
    </li>)}</ul> : null}
    <form onSubmit={(event) => void submit(event)} className="setup-form">
      <label htmlFor="user-name">{users.length ? 'Create another user' : 'What should we call you?'}</label>
      <input id="user-name" autoComplete="given-name" autoFocus={!users.length} required maxLength={100} placeholder="Your name" value={name} onChange={(event) => setName(event.target.value)} disabled={pending} />
      {error ? <p className="error" role="alert">{error}</p> : null}
      <button className="primary" disabled={pending || !name.trim()}>{pending ? 'Creating…' : 'Create user'}</button>
    </form>
    {dialog}
  </section>;
}
