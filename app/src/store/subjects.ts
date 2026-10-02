// Subject storage on the phone (AGENTS.md §5), using the new expo-file-system File/Directory API.
//   <documentDirectory>/pyqed/subjects.json        index (SubjectMeta[])
//   <documentDirectory>/pyqed/subjects/{id}.json   full subject
//   <documentDirectory>/pyqed/subjects/{id}/       page images (later milestones)
import { Directory, File, Paths } from 'expo-file-system';
import { migrate, newId, summarize, Subject, SubjectMeta, CURRENT_VERSION } from '../logic/subject';

export * from '../logic/subject';

const root = () => new Directory(Paths.document, 'pyqed');
const subjectsDir = () => new Directory(root(), 'subjects');
const indexFile = () => new File(root(), 'subjects.json');
const subjectFile = (id: string) => new File(subjectsDir(), `${id}.json`);

function ensureDirs() {
  subjectsDir().create({ intermediates: true, idempotent: true });
}

export async function listSubjects(): Promise<SubjectMeta[]> {
  const f = indexFile();
  if (!f.exists) return [];
  try {
    return JSON.parse(await f.text()) as SubjectMeta[];
  } catch {
    return []; // ponytail: corrupt index = empty list; rebuild from subjects/*.json if this ever bites
  }
}

export async function getSubject(id: string): Promise<Subject | null> {
  const f = subjectFile(id);
  if (!f.exists) return null;
  return migrate(JSON.parse(await f.text()));
}

export function emptySubject(name = '', code?: string): Subject {
  return { id: newId(), name, code, units: [], papers: [], questions: [], practice: {}, version: CURRENT_VERSION };
}

export async function saveSubject(s: Subject): Promise<void> {
  ensureDirs();
  const now = new Date().toISOString();
  const list = await listSubjects();
  const i = list.findIndex((m) => m.id === s.id);
  const meta: SubjectMeta = {
    id: s.id, name: s.name, code: s.code,
    createdAt: i >= 0 ? list[i].createdAt : now,
    updatedAt: now,
    ...summarize(s),
  };
  if (i >= 0) list[i] = meta; else list.push(meta);

  const f = subjectFile(s.id);
  if (!f.exists) f.create({ intermediates: true });
  f.write(JSON.stringify(s));
  const idx = indexFile();
  if (!idx.exists) idx.create({ intermediates: true });
  idx.write(JSON.stringify(list));
}

export async function deleteSubject(id: string): Promise<void> {
  const f = subjectFile(id);
  if (f.exists) f.delete();
  const images = new Directory(subjectsDir(), id);
  if (images.exists) images.delete();
  const list = (await listSubjects()).filter((m) => m.id !== id);
  const idx = indexFile();
  if (idx.exists) idx.write(JSON.stringify(list));
}
