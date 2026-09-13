(() => {
  'use strict'

  function upgrade(database) {
    if (!database.objectStoreNames.contains('downloads')) {
      database.createObjectStore('downloads', { keyPath: 'id' })
    }
    if (!database.objectStoreNames.contains('chunks')) {
      const chunks = database.createObjectStore('chunks', { keyPath: 'key' })
      chunks.createIndex('downloadId', 'downloadId', { unique: false })
    }
    if (!database.objectStoreNames.contains('security')) {
      database.createObjectStore('security', { keyPath: 'id' })
    }
  }

  globalThis.MabelOfflineSchema = Object.freeze({
    databaseName: 'mabeltv-offline-v1',
    version: 2,
    upgrade,
  })
})()
