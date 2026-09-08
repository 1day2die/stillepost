'use strict';

/*
 * Entries of the end to end encrypted scheme that were created before links
 * could be opened more than once have no threshold/remaining fields. The burn
 * guard requires "remaining > 0", so without this migration those entries
 * would silently become unreadable.
 */

const app = require('../app');

module.exports = {
    up: function () {
        return new Promise(function (resolve, reject) {
            console.log('MIGRATION 03_add_view_counter.js: adding view counters to existing entries.');
            app.nedb.update(
                { v: 2, remaining: { $exists: false } },
                { $set: { threshold: 1, remaining: 1 } },
                { multi: true },
                function (err, numAffected) {
                    if (err) return reject(err);
                    console.log(`MIGRATION 03_add_view_counter.js: updated ${numAffected} entries.`);
                    if (numAffected > 0) app.nedb.compactDatafile();
                    resolve();
                }
            );
        });
    },

    down: function () {
        return Promise.reject(new Error('03_add_view_counter.js cannot be reverted'));
    }
};
