import { useEffect, useState } from "react";
import type { User } from "../../shared/types";
import { api, errorMessage, readPreference, savePreference } from "./api";
import { UserPicker } from "./UserPicker";
import { Workspace } from "./Workspace";

export function App() {
  const [users, setUsers] = useState<User[] | null>(null);
  const [selectedId, setSelectedId] = useState(() => readPreference("user"));
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setError("");
    void api<{ users: User[] }>("/users", { signal: controller.signal })
      .then((data) => setUsers(data.users))
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(reason));
      });
    return () => controller.abort();
  }, [attempt]);

  function selectUser(user: User | null) {
    setSelectedId(user?.id ?? null);
    savePreference("user", user?.id ?? null);
  }

  const selected = users?.find((user) => user.id === selectedId);
  if (selected)
    return (
      <Workspace
        key={selected.id}
        user={selected}
        onSwitchUser={() => selectUser(null)}
      />
    );

  return (
    <main className="welcome">
      <div className="wordmark">bartleby.</div>
      {error ? (
        <div role="alert" className="error-panel">
          <p>{error}</p>
          <button onClick={() => setAttempt((value) => value + 1)}>
            Try again
          </button>
        </div>
      ) : users ? (
        <UserPicker
          users={users}
          onSelect={selectUser}
          onCreate={(user) => {
            setUsers((current) => [...(current ?? []), user]);
            selectUser(user);
          }}
        />
      ) : (
        <p role="status">Opening your workspace…</p>
      )}
    </main>
  );
}
