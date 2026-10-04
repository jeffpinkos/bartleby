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
