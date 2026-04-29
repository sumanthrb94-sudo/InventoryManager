import { 
  collection, 
  doc, 
  setDoc, 
  updateDoc, 
  deleteDoc, 
  getDoc, 
  getDocs, 
  query, 
  where, 
  orderBy, 
  onSnapshot,
  Timestamp,
  serverTimestamp 
} from 'firebase/firestore';
import { db, auth } from './firebase';
import { OperationType, FirestoreErrorInfo } from '../types';

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export const dbService = {
  async create(collectionName: string, id: string, data: any) {
    const path = `${collectionName}/${id}`;
    try {
      if (!auth.currentUser) throw new Error("Not authenticated");
      const docRef = doc(db, collectionName, id);
      await setDoc(docRef, {
        ...data,
        ownerId: auth.currentUser.uid,
        createdAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  },

  async update(collectionName: string, id: string, data: any) {
    const path = `${collectionName}/${id}`;
    try {
      const docRef = doc(db, collectionName, id);
      await updateDoc(docRef, {
        ...data,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  },

  async delete(collectionName: string, id: string) {
    const path = `${collectionName}/${id}`;
    try {
      const docRef = doc(db, collectionName, id);
      await deleteDoc(docRef);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  },

  subscribeToCollection(collectionName: string, callback: (data: any[]) => void, filters?: { field: string, operator: any, value: any }[]) {
    if (!auth.currentUser) return () => {};
    
    let q = query(
      collection(db, collectionName), 
      where('ownerId', '==', auth.currentUser.uid)
    );

    if (filters) {
      filters.forEach(f => {
        q = query(q, where(f.field, f.operator, f.value));
      });
    }

    return onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      callback(data);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, collectionName);
    });
  }
};
