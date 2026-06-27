import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { CADRevision } from "@/lib/agent/spec";
import type { RunHistoryRoute } from "@/lib/server/run-history";
import { sanitizeStoredText, titleFromPrompt } from "@/lib/server/sanitize";
import type { StoredMessage, StoredProject, StoredProjectSummary, StoredRevision } from "@/lib/project/types";

export const PROJECT_STORE_PATH = path.resolve(process.cwd(), "logs", "projects.json");

type ProjectStoreFile = {
  version: 1;
  projects: StoredProject[];
};

let writeQueue = Promise.resolve();

export async function listProjects({
  limit = 10,
  storePath = PROJECT_STORE_PATH,
}: {
  limit?: number;
  storePath?: string;
} = {}) {
  const store = await readStore(storePath);
  return [...store.projects]
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, limit)
    .map(projectSummary);
}

export async function getProject(projectId: string, storePath = PROJECT_STORE_PATH) {
  const store = await readStore(storePath);
  return store.projects.find((project) => project.id === projectId);
}

export async function createProject({
  prompt,
  storePath = PROJECT_STORE_PATH,
}: {
  prompt: string;
  storePath?: string;
}) {
  return mutateStore(storePath, (store) => {
    const now = new Date().toISOString();
    const project: StoredProject = {
      id: randomUUID(),
      title: titleFromPrompt(prompt),
      createdAt: now,
      updatedAt: now,
      messages: [],
      revisions: [],
    };
    store.projects.push(project);
    return project;
  });
}

export async function appendProjectMessage({
  projectId,
  role,
  content,
  route,
  revisionId,
  errorCode,
  storePath = PROJECT_STORE_PATH,
}: {
  projectId?: string;
  role: StoredMessage["role"];
  content: string;
  route?: RunHistoryRoute;
  revisionId?: string;
  errorCode?: string;
  storePath?: string;
}) {
  if (!projectId) return undefined;
  return mutateProject(projectId, storePath, (project) => {
    const message: StoredMessage = {
      id: randomUUID(),
      role,
      content: sanitizeStoredText(content, 1000),
      createdAt: new Date().toISOString(),
      route,
      revisionId,
      errorCode,
    };
    project.messages.push(message);
    project.updatedAt = message.createdAt;
    return message;
  });
}

export async function appendProjectRevision({
  projectId,
  revision,
  route,
  storePath = PROJECT_STORE_PATH,
}: {
  projectId?: string;
  revision: CADRevision;
  route?: RunHistoryRoute;
  storePath?: string;
}) {
  if (!projectId) return undefined;
  return mutateProject(projectId, storePath, (project) => {
    const storedRevision = toStoredRevision(revision);
    project.revisions = [...project.revisions.filter((item) => item.id !== storedRevision.id), storedRevision];
    project.latestRevisionId = storedRevision.id;
    project.updatedAt = new Date().toISOString();
    project.messages.push({
      id: randomUUID(),
      role: "agent",
      content: `${formatRevision(project.revisions.length)} ready for review.`,
      createdAt: project.updatedAt,
      route,
      revisionId: storedRevision.id,
    });
    return storedRevision;
  });
}

export async function appendProjectError({
  projectId,
  route,
  errorCode,
  userMessage,
  storePath = PROJECT_STORE_PATH,
}: {
  projectId?: string;
  route?: RunHistoryRoute;
  errorCode: string;
  userMessage: string;
  storePath?: string;
}) {
  if (!projectId) return undefined;
  return appendProjectMessage({
    projectId,
    role: "agent",
    content: userMessage,
    route,
    errorCode,
    storePath,
  });
}

export function projectSummary(project: StoredProject): StoredProjectSummary {
  const latestRevision = project.revisions.find((revision) => revision.id === project.latestRevisionId) ?? project.revisions.at(-1);
  return {
    id: project.id,
    title: project.title,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    latestRevisionId: project.latestRevisionId,
    revisionCount: project.revisions.length,
    messageCount: project.messages.length,
    partType: latestRevision?.engineeringSpec.partType,
  };
}

async function mutateProject<T>(projectId: string, storePath: string, mutator: (project: StoredProject) => T) {
  return mutateStore(storePath, (store) => {
    const project = store.projects.find((item) => item.id === projectId);
    if (!project) return undefined;
    return mutator(project);
  });
}

async function mutateStore<T>(storePath: string, mutator: (store: ProjectStoreFile) => T) {
  const task = writeQueue.then(async () => {
    const store = await readStore(storePath);
    const result = mutator(store);
    await writeStore(storePath, store);
    return result;
  });
  writeQueue = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}

async function readStore(storePath: string): Promise<ProjectStoreFile> {
  try {
    const text = await fs.readFile(storePath, "utf8");
    const parsed = JSON.parse(text) as ProjectStoreFile;
    if (parsed.version === 1 && Array.isArray(parsed.projects)) return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return { version: 1, projects: [] };
}

async function writeStore(storePath: string, store: ProjectStoreFile) {
  await fs.mkdir(path.dirname(storePath), { recursive: true });
  const tempPath = `${storePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, storePath);
}

function toStoredRevision(revision: CADRevision): StoredRevision {
  return {
    ...revision,
    prompt: revision.prompt ? sanitizeStoredText(revision.prompt, 1000) : undefined,
    artifacts: revision.artifacts.map((artifact) => ({ ...artifact })),
  };
}

function formatRevision(index: number) {
  return `Rev ${String(index).padStart(3, "0")}`;
}
