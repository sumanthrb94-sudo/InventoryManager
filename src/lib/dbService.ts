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
