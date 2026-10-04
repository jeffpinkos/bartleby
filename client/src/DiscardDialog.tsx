import { useEffect, useId, useRef, useState } from 'react';

function DiscardDialog({ onKeep, onDiscard }: { onKeep: () => void; onDiscard: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  return <dialog className="discard-dialog" ref={ref} aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); onKeep(); }}>
    <h2 id={titleId}>Discard unsaved changes?</h2>
    <p>Your changes haven’t been saved yet.</p>
    <div className="form-actions"><button type="button" autoFocus onClick={onKeep}>Keep editing</button><button type="button" className="danger" onClick={onDiscard}>Discard changes</button></div>
  </dialog>;
}

export function useConfirmDiscard() {
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  function confirmDiscard(dirty: boolean, action: () => void) {
    if (dirty) setPendingAction(() => action);
    else action();
  }
  const dialog = pendingAction ? <DiscardDialog onKeep={() => setPendingAction(null)} onDiscard={() => { setPendingAction(null); pendingAction(); }} /> : null;
  return { confirmDiscard, dialog };
}
