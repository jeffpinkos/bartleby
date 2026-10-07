import { useId, useState, type FormEvent } from "react";
import type { Project } from "../../shared/types";
import { errorMessage } from "./api";

export function MoveNoteForm({
  destinations,
  busy,
  onMove,
  onCancel,
}: {
  destinations: Project[];
  busy: boolean;
  onMove: (targetProjectId: string) => Promise<void>;
  onCancel: () => void;
}) {
  const selectId = useId();
  const [targetId, setTargetId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!targetId || busy || pending) return;
    setPending(true);
    setError("");
    try {
      await onMove(targetId);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      className="move-note"
      aria-label="Move note"
      onSubmit={(event) => void submit(event)}
    >
      {destinations.length ? (
        <>
          <label htmlFor={selectId}>Destination project</label>
          <div className="move-note-controls">
            <select
              id={selectId}
              autoFocus
              required
              value={targetId}
              disabled={busy || pending}
              onChange={(event) => setTargetId(event.target.value)}
            >
              <option value="" disabled>
                Choose a project
              </option>
              {destinations.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
            <div className="form-actions">
              <button
                type="button"
                className="small-button"
                onClick={onCancel}
                disabled={busy || pending}
              >
                Cancel
              </button>
              <button
                className="primary small-button"
                disabled={busy || pending || !targetId}
              >
                {pending ? "Moving…" : "Move note"}
              </button>
            </div>
          </div>
        </>
      ) : (
        <div className="move-note-controls">
          <p>Create another project to move this note.</p>
          <button
            type="button"
            className="small-button"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
        </div>
      )}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
