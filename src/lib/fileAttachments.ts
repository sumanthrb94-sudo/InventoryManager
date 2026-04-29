import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { storage } from './firebase';

export type SourceAttachmentKind = 'supplier' | 'batch' | 'unit' | 'import';

export interface SourceAttachmentRecord {
  fileName: string;
  mimeType: string;
  size: number;
  storagePath: string;
  downloadURL: string;
  linkedType: SourceAttachmentKind;
  linkedId: string;
}

function sanitizeFileName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]+/g, '_');
}

export async function uploadSourceAttachment(file: File, linkedType: SourceAttachmentKind, linkedId: string) {
  const id = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const safeName = sanitizeFileName(file.name);
  const storagePath = `source-documents/${linkedType}/${linkedId}/${id}_${safeName}`;
  const fileRef = ref(storage, storagePath);
  await uploadBytes(fileRef, file, {
    contentType: file.type || 'application/octet-stream',
  });
  const downloadURL = await getDownloadURL(fileRef);

  return {
    fileName: file.name,
    mimeType: file.type || 'application/octet-stream',
    size: file.size,
    storagePath,
    downloadURL,
    linkedType,
    linkedId,
  } satisfies SourceAttachmentRecord;
}

export async function uploadSourceAttachments(files: File[], linkedType: SourceAttachmentKind, linkedId: string) {
  const uploaded: SourceAttachmentRecord[] = [];
  for (const file of files) {
    uploaded.push(await uploadSourceAttachment(file, linkedType, linkedId));
  }
  return uploaded;
}
