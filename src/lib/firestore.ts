import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  deleteDoc,
  updateDoc,
} from 'firebase/firestore';
import { db } from './firebase';
import type { User, CaptureLog, Project, Report } from '@/types';

function getDb() {
  if (!db) throw new Error('Firebase not initialized');
  return db;
}

// ---- Users ----
export async function createUser(user: User) {
  await setDoc(doc(getDb(), 'users', user.uid), user);
}

export async function getUser(uid: string): Promise<User | null> {
  const snap = await getDoc(doc(getDb(), 'users', uid));
  return snap.exists() ? (snap.data() as User) : null;
}

// ---- Capture Logs ----
export async function saveLog(log: CaptureLog) {
  await setDoc(doc(getDb(), 'logs', log.id), log);
}

export async function getLogsByUser(userId: string): Promise<CaptureLog[]> {
  const q = query(
    collection(getDb(), 'logs'),
    where('userId', '==', userId),
    orderBy('timestamp', 'desc')
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as CaptureLog);
}

export async function getLogsByProject(projectId: string): Promise<CaptureLog[]> {
  const q = query(
    collection(getDb(), 'logs'),
    where('projectId', '==', projectId),
    orderBy('timestamp', 'asc')
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as CaptureLog);
}

export async function getAllLogs(): Promise<CaptureLog[]> {
  const q = query(
    collection(getDb(), 'logs'),
    orderBy('timestamp', 'desc')
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as CaptureLog);
}

export async function deleteLog(logId: string) {
  await deleteDoc(doc(getDb(), 'logs', logId));
}

// ---- Projects ----
export async function createProject(project: Project) {
  await setDoc(doc(getDb(), 'projects', project.id), project);
}

export async function getProjectsByUser(userId: string): Promise<Project[]> {
  const q = query(
    collection(getDb(), 'projects'),
    where('userId', '==', userId),
    orderBy('updatedAt', 'desc')
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as Project);
}

export async function getAllProjects(): Promise<Project[]> {
  const q = query(
    collection(getDb(), 'projects'),
    orderBy('updatedAt', 'desc')
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as Project);
}

export async function updateProject(projectId: string, data: Partial<Project>) {
  await updateDoc(doc(getDb(), 'projects', projectId), data);
}

export async function deleteProject(projectId: string) {
  await deleteDoc(doc(getDb(), 'projects', projectId));
}

// ---- Reports ----
export async function saveReport(report: Report) {
  await setDoc(doc(getDb(), 'reports', report.id), report);
}

export async function getReportsByProject(projectId: string): Promise<Report[]> {
  const q = query(
    collection(getDb(), 'reports'),
    where('projectId', '==', projectId),
    orderBy('generatedAt', 'desc')
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as Report);
}
