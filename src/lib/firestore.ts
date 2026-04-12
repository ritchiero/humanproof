import { getFirestore, collection, query, where, getDocs, addDoc, updateDoc, doc } from 'firebase/firestore';
import { app } from './firebase';
import type { Project, CaptureLog } from '@/types';

const db = getFirestore(app);

export async function getProjectsByUser(userId: string): Promise<Project[]> {
  const q = query(collection(db, 'projects'), where('userId', '==', userId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Project));
}

export async function getLogsByUser(userId: string): Promise<CaptureLog[]> {
  const q = query(collection(db, 'logs'), where('userId', '==', userId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as CaptureLog));
}

export async function saveLog(log: CaptureLog): Promise<void> {
  await addDoc(collection(db, 'logs'), log);
}

export async function createProject(project: Project): Promise<void> {
  await addDoc(collection(db, 'projects'), project);
}
