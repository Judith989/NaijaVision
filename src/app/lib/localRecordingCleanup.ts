export async function removeLocalRecordingCopies(ids: string[]) {
  const selected = new Set(ids);
  if (!selected.size) return;
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("naijavision-local", 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("clips")) request.result.createObjectStore("clips", { keyPath: "id" });
      if (!request.result.objectStoreNames.contains("settings")) request.result.createObjectStore("settings", { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("clips", "readwrite");
      const request = tx.objectStore("clips").openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        if (selected.has(cursor.value.id) || selected.has(cursor.value.backendRecordingId)) cursor.delete();
        cursor.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
