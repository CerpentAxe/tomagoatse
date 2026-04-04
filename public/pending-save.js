/**
 * Pending creature save before login: sessionStorage fills up quickly when the payload
 * includes a hatchery data-URL portrait. Fall back to localStorage, then IndexedDB.
 */

export const PENDING_SAVE_KEY = "tomagoatse-pending-save";

const IDB_NAME = "tomagoatse-pending";
const IDB_STORE = "kv";
const IDB_KEY = "pendingSaveJson";

function isQuotaError(e) {
  return (
    e &&
    (e.name === "QuotaExceededError" ||
      e.code === 22 ||
      e.code === 1014 ||
      /quota|storage/i.test(String(e.message || "")))
  );
}

function openIdb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onerror = () => reject(req.error);
    req.onupgradeneeded = (ev) => {
      const db = ev.target.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
}

async function idbPut(jsonString) {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
    tx.objectStore(IDB_STORE).put(jsonString, IDB_KEY);
  });
}

async function idbGet() {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const r = tx.objectStore(IDB_STORE).get(IDB_KEY);
    r.onsuccess = () => {
      db.close();
      resolve(r.result ?? null);
    };
    r.onerror = () => reject(r.error);
  });
}

async function idbClear() {
  try {
    const db = await openIdb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
      tx.objectStore(IDB_STORE).delete(IDB_KEY);
    });
  } catch {
    /* ignore */
  }
}

/**
 * @param {object} payload
 */
export async function storePendingSavePayload(payload) {
  const json = JSON.stringify(payload);
  try {
    sessionStorage.setItem(PENDING_SAVE_KEY, json);
    try {
      localStorage.removeItem(PENDING_SAVE_KEY);
    } catch {
      /* ignore */
    }
    await idbClear();
    return;
  } catch (e) {
    if (!isQuotaError(e)) throw e;
  }
  try {
    localStorage.setItem(PENDING_SAVE_KEY, json);
    try {
      sessionStorage.removeItem(PENDING_SAVE_KEY);
    } catch {
      /* ignore */
    }
    await idbClear();
    return;
  } catch (e) {
    if (!isQuotaError(e)) throw e;
  }
  try {
    sessionStorage.removeItem(PENDING_SAVE_KEY);
  } catch {
    /* ignore */
  }
  try {
    localStorage.removeItem(PENDING_SAVE_KEY);
  } catch {
    /* ignore */
  }
  await idbPut(json);
}

/** @returns {Promise<string|null>} */
export async function loadPendingSavePayloadString() {
  try {
    const s = sessionStorage.getItem(PENDING_SAVE_KEY);
    if (s) return s;
  } catch {
    /* ignore */
  }
  try {
    const s = localStorage.getItem(PENDING_SAVE_KEY);
    if (s) return s;
  } catch {
    /* ignore */
  }
  try {
    return await idbGet();
  } catch {
    return null;
  }
}

export async function clearPendingSavePayload() {
  try {
    sessionStorage.removeItem(PENDING_SAVE_KEY);
  } catch {
    /* ignore */
  }
  try {
    localStorage.removeItem(PENDING_SAVE_KEY);
  } catch {
    /* ignore */
  }
  await idbClear();
}
