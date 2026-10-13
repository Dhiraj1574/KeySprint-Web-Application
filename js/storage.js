/* ============================================================
   KeySprint - storage.js
   The only file that reads or writes localStorage.

   Every saved value is wrapped in an envelope:
     { schemaVersion: 1, savedAt: "<ISO time>", data: <value> }

   Missing, unreadable or wrongly shaped values return a safe
   default. Unreadable raw data is copied to a backup key first.
   ============================================================ */
(function () {
  'use strict';

  /* ============================================================
     CONFIGURATION
     ============================================================ */

  var PREFIX = 'keysprint:v1:';
  var SCHEMA_VERSION = 1;
  var BACKUP_TAG = 'backup:';

  var KEYS = {
    users: 'users',
    session: 'session',
    settings: 'settings',
    sessions: 'sessions'
  };

  var DEFAULTS = {
    users: {},
    session: null,
    settings: {
      theme: 'dark',
      defaultDifficulty: 'intermediate',
      defaultDuration: 300,
      reducedMotion: false
    },
    sessions: {}
  };

  /* ============================================================
     HELPERS
     ============================================================ */

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function isKnownKey(name) {
    return Object.prototype.hasOwnProperty.call(KEYS, name);
  }

  function isStorageAvailable() {
    try {
      var probe = PREFIX + '__probe__';
      window.localStorage.setItem(probe, '1');
      window.localStorage.removeItem(probe);
      return true;
    } catch (err) {
      return false;
    }
  }

  function backupCorruptValue(name, raw) {
    try {
      var backupKey = PREFIX + BACKUP_TAG + name + ':' + Date.now();
      window.localStorage.setItem(backupKey, raw);
    } catch (err) {
    }
  }

  /* ============================================================
     READ
     ============================================================ */

  function read(name) {
    if (!isKnownKey(name)) {
      throw new Error('storage.read: unknown key "' + name + '"');
    }

    var fallback = clone(DEFAULTS[name]);

    if (!isStorageAvailable()) {
      return { value: fallback, status: 'unavailable' };
    }

    var raw = null;
    try {
      raw = window.localStorage.getItem(PREFIX + name);
    } catch (err) {
      return { value: fallback, status: 'unavailable' };
    }

    if (raw === null) {
      return { value: fallback, status: 'empty' };
    }

    try {
      var parsed = JSON.parse(raw);
      if (
        parsed !== null &&
        typeof parsed === 'object' &&
        parsed.schemaVersion === SCHEMA_VERSION &&
        Object.prototype.hasOwnProperty.call(parsed, 'data')
      ) {
        return { value: parsed.data, status: 'ok' };
      }
      throw new Error('Unexpected stored shape');
    } catch (err) {
      backupCorruptValue(name, raw);
      try {
        window.localStorage.removeItem(PREFIX + name);
      } catch (removeErr) {
      }
      return { value: fallback, status: 'corrupt' };
    }
  }

  /* ============================================================
     WRITE
     ============================================================ */

  function write(name, data) {
    if (!isKnownKey(name)) {
      throw new Error('storage.write: unknown key "' + name + '"');
    }
    if (!isStorageAvailable()) {
      return false;
    }

    var envelope = {
      schemaVersion: SCHEMA_VERSION,
      savedAt: new Date().toISOString(),
      data: data
    };

    try {
      window.localStorage.setItem(PREFIX + name, JSON.stringify(envelope));
      return true;
    } catch (err) {
      return false;
    }
  }

  /* ============================================================
     REMOVE AND RESET
     ============================================================ */

  function remove(name) {
    if (!isKnownKey(name)) {
      throw new Error('storage.remove: unknown key "' + name + '"');
    }
    try {
      window.localStorage.removeItem(PREFIX + name);
      return true;
    } catch (err) {
      return false;
    }
  }

  function resetAll() {
    try {
      var toRemove = [];
      for (var i = 0; i < window.localStorage.length; i++) {
        var key = window.localStorage.key(i);
        if (key && key.indexOf(PREFIX) === 0) {
          toRemove.push(key);
        }
      }
      toRemove.forEach(function (key) {
        window.localStorage.removeItem(key);
      });
      return true;
    } catch (err) {
      return false;
    }
  }

  /* ============================================================
     PUBLIC API
     ============================================================ */

  window.KS = window.KS || {};
  window.KS.storage = {
    KEYS: KEYS,
    DEFAULTS: DEFAULTS,
    read: read,
    write: write,
    remove: remove,
    resetAll: resetAll,
    isAvailable: isStorageAvailable
  };
})();