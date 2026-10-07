import { useId, useState, type FormEvent } from "react";
import type { NoteInput } from "../../shared/types";
import { errorMessage } from "./api";
import { useDraftGuard, type DraftChange } from "./useDraftGuard";
import { useConfirmDiscard } from "./DiscardDialog";

export function NoteForm({
  id,
  initial,
  disabled,
  onSave,
  onCancel,
  onDirtyChange,
}: {
  id: string;
  initial?: NoteInput;
  disabled: boolean;
  onSave: (input: NoteInput) => Promise<void>;
  onCancel?: () => void;
  onDirtyChange: DraftChange;
}) {
  const fieldId = useId();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const { confirmDiscard, dialog } = useConfirmDiscard();
  const dirty =
    title !== (initial?.title ?? "") || body !== (initial?.body ?? "");
  useDraftGuard(id, dirty, onDirtyChange);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!body.trim() || pending || disabled) return;
    setPending(true);
    setError("");
    try {
      await onSave({ title, body });
      if (!initial) {
        setTitle("");
        setBody("");
      }
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      className="note-form"
      aria-label={initial ? "Edit note" : "New note"}
      onSubmit={(event) => void submit(event)}
    >
      <div className="note-fields">
        <label className="sr-only" htmlFor={`${fieldId}-title`}>
          Title (optional)
        </label>
        <input
          id={`${fieldId}-title`}
          autoFocus={!!initial}
          maxLength={200}
          placeholder="Title (optional)"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          disabled={disabled || pending}
        />
        <label className="sr-only" htmlFor={`${fieldId}-body`}>
          What’s on your mind?
        </label>
        <textarea
          id={`${fieldId}-body`}
          required
          maxLength={100000}
          rows={6}
          placeholder="What’s on your mind?"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          disabled={disabled || pending}
        />
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <div className="note-form-footer">
        <span className="composer-hint">
          {initial
            ? "A little room to rethink."
            : "A thought, a sentence, a starting point."}
        </span>
        <div className="form-actions">
          {onCancel ? (
            <button
              type="button"
              onClick={() => confirmDiscard(dirty, onCancel)}
              disabled={pending || disabled}
            >
              Cancel
            </button>
          ) : null}
          <button
            className="primary"
            disabled={
              pending || disabled || !body.trim() || (!!initial && !dirty)
            }
          >
            {pending ? "Saving…" : initial ? "Save changes" : "Add note"}
          </button>
        </div>
      </div>
      {dialog}
    </form>
  );
}
