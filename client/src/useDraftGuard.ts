import { useEffect } from "react";

export type DraftChange = (id: string, dirty: boolean) => void;

export function useDraftGuard(
  id: string,
  dirty: boolean,
  onChange?: DraftChange,
) {
  useEffect(() => {
    onChange?.(id, dirty);
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    if (dirty) window.addEventListener("beforeunload", warn);
    return () => {
      onChange?.(id, false);
      window.removeEventListener("beforeunload", warn);
    };
  }, [id, dirty, onChange]);
}
