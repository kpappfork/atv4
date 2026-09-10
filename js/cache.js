var Cache = (function() {
    // Named lifetimes. Everything used to be cached for 60 seconds, which is far
    // too short for data that never changes and arguably too long for watch state.
    const TTL = {
        reference: 7 * 24 * 3600,   // types, genres, countries, server lists
        artwork: 30 * 24 * 3600,    // TMDB/fanart metadata: immutable for an id
        listing: 60,                // item shelves
        volatile: 30                // anything tied to what the user just did
    };

    const PREFIX = 'cache_';
    const MAX_ENTRIES = 250;
    // TVJS localStorage is small, so only short values are worth persisting.
    // Item listings run to hundreds of KB and stay in memory only.
    const MAX_PERSIST_BYTES = 32 * 1024;

    var items = {};

    function now() { return new Date().getTime(); }

    function readPersisted(key) {
        try {
            var raw = localStorage.getItem(PREFIX + key);
            if (!raw) { return undefined; }
            var entry = JSON.parse(raw);
            if (!entry || typeof entry.expire !== 'number') { return undefined; }
            if (entry.expire <= now()) {
                localStorage.removeItem(PREFIX + key);
                return undefined;
            }
            return entry;
        } catch (e) {
            return undefined;
        }
    }

    function writePersisted(key, value, expire) {
        try {
            var serialized = JSON.stringify({ value: value, expire: expire });
            if (serialized.length > MAX_PERSIST_BYTES) { return; }
            localStorage.setItem(PREFIX + key, serialized);
        } catch (e) {
            // A full or unavailable store must never break a request.
            console.log('Cache: could not persist "' + key + '": ' + e);
        }
    }

    // Keeps memory bounded: without this every filter combination accumulated.
    function evictIfNeeded() {
        var keys = Object.keys(items);
        if (keys.length <= MAX_ENTRIES) { return; }
        keys.sort(function(a, b) { return items[a].expire - items[b].expire; });
        for (var i = 0; i < keys.length - MAX_ENTRIES; i++) { delete items[keys[i]]; }
    }

    return {
        TTL: TTL,

        get: function(key) {
            var entry = items[key];
            if (entry && entry.expire > now()) { return entry.value; }
            if (entry) { delete items[key]; }

            var stored = readPersisted(key);
            if (stored) {
                items[key] = stored;         // promote back into memory
                return stored.value;
            }
            return undefined;
        },

        // `persist` keeps the entry across launches. Only pass it for small,
        // slow-changing values.
        set: function(key, value, expire, persist) {
            var seconds = parseInt(expire, 10);
            if (!seconds || seconds < 0) { seconds = TTL.listing; }
            var expiresAt = now() + seconds * 1000;
            items[key] = { value: value, expire: expiresAt };
            if (persist) { writePersisted(key, value, expiresAt); }
            evictIfNeeded();
        },

        remove: function(key) {
            delete items[key];
            try { localStorage.removeItem(PREFIX + key); } catch (e) { /* nothing to do */ }
        },

        // Only frees memory; reads already expire lazily.
        scan: function() {
            var current = now();
            Object.keys(items).forEach(function(key) {
                if (items[key].expire <= current) { delete items[key]; }
            });
        },

        size: function() { return Object.keys(items).length; }
    };
}());
