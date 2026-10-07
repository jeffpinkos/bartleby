export interface User {
  id: string;
  name: string;
}

export interface Project {
  id: string;
  userId: string;
  name: string;
  description: string;
  noteCount: number;
  archived: boolean;
}

export interface Note {
  id: string;
  projectId: string;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface NoteInput {
  title: string;
  body: string;
}

export interface NoteSearchResult {
  id: string;
  projectId: string;
  projectName: string;
  title: string;
  excerpt: string;
}

export interface NoteSearchResponse {
  notes: NoteSearchResult[];
  hasMore: boolean;
}

export interface ProjectInput {
  name: string;
  description: string;
}
