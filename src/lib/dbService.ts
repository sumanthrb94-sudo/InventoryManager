/**
 * LocalStorage-based Database Service
 * Bypasses Firebase Auth and Firestore permission issues completely.
 *
 * This allows the app to work 100% locally with instant saves and reads.
 */

function getTable(collectionName: string): any[] {
  try {
    const data = localStorage.getItem(`nexus_db_${collectionName}`);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

function saveTable(collectionName: string, data: any[]) {
  localStorage.setItem(`nexus_db_${collectionName}`, JSON.stringify(data));
}

// In-memory pub/sub for real-time updates across components
const listeners: Record<string, Function[]> = {};

function notifyListeners(collectionName: string) {
  const data = getTable(collectionName);
  if (listeners[collectionName]) {
    listeners[collectionName].forEach(cb => cb([...data]));
  }
}

export const dbService = {
  async create(collectionName: string, id: string, data: any) {
    const table = getTable(collectionName);
    const existingIdx = table.findIndex(item => item.id === id);
    const newItem = {
      ...data,
      id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    if (existingIdx >= 0) {
      table[existingIdx] = newItem;
    } else {
      table.push(newItem);
    }

    saveTable(collectionName, table);
    notifyListeners(collectionName);
  },

  /**
   * bulkCreate — write many documents in one shot with a SINGLE notification at the end.
   * Use this for imports to avoid the React #185 "max update depth" crash caused by
   * notifyListeners firing thousands of React setState calls in a tight loop.
   */
  async bulkCreate(
    entries: Array<{ collection: string; id: string; data: any }>,
    onProgress?: (done: number, total: number) => void
  ) {
    // Group by collection so we only open/write/save each table once per chunk
    const byCollection: Record<string, { id: string; data: any }[]> = {};
    for (const e of entries) {
      if (!byCollection[e.collection]) byCollection[e.collection] = [];
      byCollection[e.collection].push({ id: e.id, data: e.data });
    }

    let done = 0;
    const total = entries.length;

    // Write all collections silently (no notifyListeners yet)
    for (const [collectionName, items] of Object.entries(byCollection)) {
      const table = getTable(collectionName);
      for (const item of items) {
        const existingIdx = table.findIndex(r => r.id === item.id);
        const newItem = {
          ...item.data,
          id: item.id,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        if (existingIdx >= 0) {
          table[existingIdx] = newItem;
        } else {
          table.push(newItem);
        }
        done++;
        // Report progress every 50 items
        if (onProgress && done % 50 === 0) {
          onProgress(done, total);
          // Yield to browser so UI can repaint the progress bar
          await new Promise(r => setTimeout(r, 0));
        }
      }
      // Save the whole collection in one localStorage write
      saveTable(collectionName, table);
    }

    // Final progress update
    if (onProgress) onProgress(total, total);
    // Yield once more before notifying
    await new Promise(r => setTimeout(r, 0));

    // Fire ONE notification per collection after all writes are done
    const collectionNames = Object.keys(byCollection);
    for (const name of collectionNames) {
      notifyListeners(name);
    }
  },

  async update(collectionName: string, id: string, data: any) {
    const table = getTable(collectionName);
    const existingIdx = table.findIndex(item => item.id === id);

    if (existingIdx >= 0) {
      table[existingIdx] = {
        ...table[existingIdx],
        ...data,
        updatedAt: new Date().toISOString(),
      };
      saveTable(collectionName, table);
      notifyListeners(collectionName);
    }
  },

  async delete(collectionName: string, id: string) {
    let table = getTable(collectionName);
    table = table.filter(item => item.id !== id);
    saveTable(collectionName, table);
    notifyListeners(collectionName);
  },

  subscribeToCollection(collectionName: string, callback: (data: any[]) => void) {
    if (!listeners[collectionName]) {
      listeners[collectionName] = [];
    }
    listeners[collectionName].push(callback);

    // Initial fetch
    callback(getTable(collectionName));

    return () => {
      listeners[collectionName] = listeners[collectionName].filter(cb => cb !== callback);
    };
  },

  subscribeToCollectionOrdered(
    collectionName: string,
    orderField: string,
    direction: 'asc' | 'desc' = 'desc',
    callback: (data: any[]) => void
  ) {
    if (!listeners[collectionName]) {
      listeners[collectionName] = [];
    }

    const wrappedCallback = (data: any[]) => {
      const sorted = [...data].sort((a, b) => {
        const valA = a[orderField];
        const valB = b[orderField];
        if (valA < valB) return direction === 'asc' ? -1 : 1;
        if (valA > valB) return direction === 'asc' ? 1 : -1;
        return 0;
      });
      callback(sorted);
    };

    listeners[collectionName].push(wrappedCallback);

    // Initial fetch
    wrappedCallback(getTable(collectionName));

    return () => {
      listeners[collectionName] = listeners[collectionName].filter(cb => cb !== wrappedCallback);
    };
  },
};
