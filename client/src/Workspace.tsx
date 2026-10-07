import { useCallback, useEffect, useState } from "react";
import type { NoteSearchResult, Project, User } from "../../shared/types";
import { api, errorMessage, readPreference, savePreference } from "./api";
import { Sidebar } from "./Sidebar";
import { ProjectForm } from "./ProjectForm";
import { ProjectView } from "./ProjectView";
import { SearchView } from "./SearchView";
import { ArchiveView } from "./ArchiveView";
import { useConfirmDiscard } from "./DiscardDialog";

export function Workspace({
  user,
  onSwitchUser,
}: {
  user: User;
  onSwitchUser: () => void;
}) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [archivedProjects, setArchivedProjects] = useState<Project[] | null>(
    null,
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<
    "view" | "create" | "edit" | "search" | "archive"
  >("view");
  const [search, setSearch] = useState({ query: "", version: 0 });
  const [targetNoteId, setTargetNoteId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [dirtyForms, setDirtyForms] = useState(() => new Set<string>());
  const { confirmDiscard, dialog } = useConfirmDiscard();

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        (event.target instanceof Element &&
          event.target.closest(
            'input, textarea, select, button, a, [contenteditable="true"], [role="textbox"]',
          ))
      ) {
        return;
      }

      if (event.key === "n" && mode === "view" && !busy) {
        const composer = document.querySelector<HTMLTextAreaElement>(
          '.note-form[aria-label="New note"] textarea',
        );
        if (composer) {
          event.preventDefault();
          composer.focus();
        }
      } else if (event.key === "/" && !busy) {
        const search = document.getElementById("note-search");
        if (search instanceof HTMLInputElement && !search.disabled) {
          event.preventDefault();
          search.focus();
        }
      }
    }

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [busy, mode]);

  const onDirtyChange = useCallback((id: string, dirty: boolean) => {
    setDirtyForms((current) => {
      if (current.has(id) === dirty) return current;
      const next = new Set(current);
      if (dirty) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const onNoteCountChange = useCallback((projectId: string, count: number) => {
    setProjects(
      (current) =>
        current?.map((project) =>
          project.id === projectId ? { ...project, noteCount: count } : project,
        ) ?? null,
    );
  }, []);

  const onNoteMoved = useCallback(
    (sourceId: string, targetId: string, sourceCount: number) => {
      setProjects(
        (current) =>
          current?.map((project) => {
            if (project.id === sourceId)
              return { ...project, noteCount: sourceCount };
            if (project.id === targetId)
              return { ...project, noteCount: project.noteCount + 1 };
            return project;
          }) ?? null,
      );
    },
    [],
  );

  useEffect(() => {
    const controller = new AbortController();
    setError("");
    void Promise.all([
      api<{ projects: Project[] }>(`/users/${user.id}/projects`, {
        signal: controller.signal,
      }),
      api<{ projects: Project[] }>(
        `/users/${user.id}/projects?archived=true`,
        { signal: controller.signal },
      ),
    ])
      .then(([{ projects: items }, { projects: archivedItems }]) => {
        setProjects(items);
        setArchivedProjects(archivedItems);
        const remembered = readPreference(`project.${user.id}`);
        setSelectedId(
          items.find((project) => project.id === remembered)?.id ??
            items[0]?.id ??
            null,
        );
        setMode(items.length === 0 ? "create" : "view");
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(reason));
      });
    return () => controller.abort();
  }, [user.id, attempt]);

  function navigate(action: () => void) {
    if (!busy) confirmDiscard(dirtyForms.size > 0, action);
  }
  function selectProject(id: string) {
    if (id === selectedId && mode === "view") return;
    navigate(() => {
      setSelectedId(id);
      setTargetNoteId(null);
      savePreference(`project.${user.id}`, id);
      setMode("view");
    });
  }
  function searchNotes(query: string) {
    navigate(() => {
      setSearch((current) => ({ query, version: current.version + 1 }));
      setMode("search");
    });
  }
  function openSearchResult(note: NoteSearchResult) {
    navigate(() => {
      setSelectedId(note.projectId);
      setTargetNoteId(note.id);
      savePreference(`project.${user.id}`, note.projectId);
      setMode("view");
    });
  }
  const selected = projects?.find((project) => project.id === selectedId);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to notes
      </a>
      <Sidebar
        user={user}
        projects={projects ?? []}
        selectedId={
          mode === "create" || mode === "search" || mode === "archive"
            ? null
            : selectedId
        }
        disabled={busy || !projects || !archivedProjects}
        onSelect={selectProject}
        onNew={() => {
          if (mode !== "create") navigate(() => setMode("create"));
        }}
        onSwitchUser={() => navigate(onSwitchUser)}
        onSearch={searchNotes}
        onShowArchive={() => navigate(() => setMode("archive"))}
        archivedProjectCount={archivedProjects?.length ?? 0}
      />
      <main className="workspace" id="main-content">
        {error ? (
          <div className="error-panel" role="alert">
            <h1>Couldn’t open your projects.</h1>
            <p>{error}</p>
            <button onClick={() => setAttempt((value) => value + 1)}>
              Try again
            </button>
          </div>
        ) : !projects || !archivedProjects ? (
          <p role="status">Opening your projects…</p>
        ) : mode === "search" ? (
          <SearchView
            key={search.version}
            userId={user.id}
            query={search.query}
            onOpen={openSearchResult}
          />
        ) : mode === "archive" ? (
          <ArchiveView
            projects={archivedProjects}
            busy={busy}
            onRestore={(project) => {
              setError("");
              setBusy(true);
              void api<{ project: Project }>(
                `/users/${user.id}/projects/${project.id}`,
                { method: "PATCH", body: JSON.stringify({ archived: false }) },
              )
                .then(async ({ project: restored }) => {
                  const { projects: activeProjects } =
                    await api<{ projects: Project[] }>(
                      `/users/${user.id}/projects`,
                    );
                  setProjects(activeProjects);
                  setArchivedProjects(
                    (current) =>
                      current?.filter((item) => item.id !== restored.id) ?? [],
                  );
                  setSelectedId(restored.id);
                  setTargetNoteId(null);
                  savePreference(`project.${user.id}`, restored.id);
                  setMode("view");
                })
                .catch((reason: unknown) => setError(errorMessage(reason)))
                .finally(() => setBusy(false));
            }}
          />
        ) : mode === "create" || mode === "edit" ? (
          <ProjectForm
            key={mode === "edit" ? selectedId : "new"}
            userId={user.id}
            isFirst={!projects.length}
            initial={mode === "edit" ? selected : undefined}
            onDirtyChange={onDirtyChange}
            onBusyChange={setBusy}
            onCancel={() => navigate(() => setMode("view"))}
            onSaved={(project) => {
              setProjects((current) =>
                current?.some((item) => item.id === project.id)
                  ? current.map((item) =>
                      item.id === project.id ? project : item,
                    )
                  : [...(current ?? []), project],
              );
              setSelectedId(project.id);
              if (mode === "create") setTargetNoteId(null);
              savePreference(`project.${user.id}`, project.id);
              setMode("view");
            }}
          />
        ) : selected ? (
          <ProjectView
            key={selected.id}
            userId={user.id}
            project={selected}
            projects={projects}
            targetNoteId={targetNoteId}
            onBackToSearch={
              targetNoteId ? () => searchNotes(search.query) : undefined
            }
            busy={busy}
            onBusyChange={setBusy}
            onDirtyChange={onDirtyChange}
            onNoteCountChange={onNoteCountChange}
            onNoteMoved={onNoteMoved}
            onEdit={() => navigate(() => setMode("edit"))}
            onArchive={() =>
              navigate(() => {
                setError("");
                setBusy(true);
                void api<{ project: Project }>(
                  `/users/${user.id}/projects/${selected.id}`,
                  { method: "PATCH", body: JSON.stringify({ archived: true }) },
                )
                  .then(({ project: archived }) => {
                    const remaining = projects.filter((item) => item.id !== archived.id);
                    setProjects(remaining);
                    setArchivedProjects((current) => [...(current ?? []), archived]);
                    const next = remaining[0];
                    setSelectedId(next?.id ?? null);
                    if (next) savePreference(`project.${user.id}`, next.id);
                    setTargetNoteId(null);
                    setMode(next ? "view" : "create");
                  })
                  .catch((reason: unknown) => setError(errorMessage(reason)))
                  .finally(() => setBusy(false));
              })
            }
          />
        ) : null}
      </main>
      {dialog}
    </div>
  );
}
