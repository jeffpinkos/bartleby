import { useEffect, useRef, useState } from "react";
import type { NoteSearchResponse, NoteSearchResult } from "../../shared/types";
import { api, errorMessage } from "./api";

export function SearchView({
  userId,
  query,
  onOpen,
}: {
  userId: string;
  query: string;
  onOpen: (note: NoteSearchResult) => void;
}) {
  const [results, setResults] = useState<NoteSearchResponse | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    heading.current?.focus();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setResults(null);
    setError("");
    void api<NoteSearchResponse>(
      `/users/${userId}/notes/search?q=${encodeURIComponent(query)}`,
      { signal: controller.signal },
    )
      .then((data) => {
        if (!controller.signal.aborted) setResults(data);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(reason));
      });
    return () => controller.abort();
  }, [userId, query, attempt]);

  return (
    <section aria-labelledby="search-title">
      <header className="page-heading">
        <h1 id="search-title" ref={heading} tabIndex={-1}>
          Search notes
        </h1>
        <p className="subtitle">Results for “{query}” across your projects.</p>
      </header>
      {error ? (
        <div className="error-panel" role="alert">
          <p>{error}</p>
          <button onClick={() => setAttempt((value) => value + 1)}>
            Try again
          </button>
        </div>
      ) : results === null ? (
        <p role="status">Searching your notes…</p>
      ) : (
        <>
          <p className="search-summary" role="status">
            {results.hasMore
              ? "Showing the first 50 matches. Try a more specific search."
              : results.notes.length === 0
                ? "No matching notes. Try another word or phrase."
                : `${results.notes.length} ${results.notes.length === 1 ? "note" : "notes"} found.`}
          </p>
          <ul className="search-results" aria-label="Search results">
            {results.notes.map((note) => (
              <li key={note.id}>
                <button className="search-result" onClick={() => onOpen(note)}>
                  <span className="search-project">{note.projectName}</span>
                  <span className="search-note-title">
                    {note.title || "Untitled note"}
                  </span>
                  <span className="search-excerpt">{note.excerpt}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
