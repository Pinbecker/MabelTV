'use strict';

(() => {
  const DATABASE = 'mabeltv-app-cache-v1'
  const VERSION = 1
  const STORE = 'snapshots'
  let openPromise = null

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error || new Error('App cache request failed'))
    })
  }

  function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = resolve
      transaction.onerror = () => reject(transaction.error || new Error('App cache write failed'))
      transaction.onabort = () => reject(transaction.error || new Error('App cache write was interrupted'))
    })
  }

  function openDatabase() {
    if (openPromise) return openPromise
    openPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE, VERSION)
      request.onupgradeneeded = () => {
        const database = request.result
        if (!database.objectStoreNames.contains(STORE)) {
          database.createObjectStore(STORE, { keyPath: 'id' })
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error || new Error('App cache is unavailable'))
    }).catch(error => {
      openPromise = null
      throw error
    })
    return openPromise
  }

  async function read(id) {
    const database = await openDatabase()
    return requestResult(database.transaction(STORE).objectStore(STORE).get(id))
  }

  async function write(id, revision, data) {
    const database = await openDatabase()
    const transaction = database.transaction(STORE, 'readwrite')
    transaction.objectStore(STORE).put({
      id,
      schema: 1,
      revision: Number(revision || 0),
      savedAt: Date.now(),
      data,
    })
    await transactionDone(transaction)
  }

  async function remove(id) {
    const database = await openDatabase()
    const transaction = database.transaction(STORE, 'readwrite')
    transaction.objectStore(STORE).delete(id)
    await transactionDone(transaction)
  }

  async function clear() {
    const database = await openDatabase()
    const transaction = database.transaction(STORE, 'readwrite')
    transaction.objectStore(STORE).clear()
    await transactionDone(transaction)
  }

  async function storageStatus() {
    let estimate = null
    if (navigator.storage?.estimate) {
      estimate = await navigator.storage.estimate().catch(() => null)
    }
    let persistent = false
    if (navigator.storage?.persisted) {
      persistent = await navigator.storage.persisted().catch(() => false)
    }
    return {
      persistent,
      usage: Number(estimate?.usage || 0),
      quota: Number(estimate?.quota || 0),
    }
  }

  async function initialise() {
    if (!('indexedDB' in window)) return false
    await openDatabase()
    if (navigator.storage?.persist) {
      navigator.storage.persist().catch(() => false)
    }
    try {
      for (let index = localStorage.length - 1; index >= 0; index -= 1) {
        const key = localStorage.key(index)
        if (key?.startsWith('mabeltv-data-')) localStorage.removeItem(key)
      }
    } catch (_) { /* Legacy response caches are disposable. */ }
    return true
  }

  window.MabelAppCache = Object.freeze({
    databaseName: DATABASE,
    initialise,
    read,
    write,
    remove,
    clear,
    storageStatus,
  })
})()
