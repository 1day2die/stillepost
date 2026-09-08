'use strict';

const path = require('path');
const fs = require('fs');

const app = require('../app');

module.exports = {
    up: function () {
        return new Promise(function (resolve, reject) {
            console.log('MIGRATION 02_migrate2nedb.js: start migration to nedb.');
            const nedb = app.nedb;
            const dbPath = path.resolve(__dirname, '../data');

            if (!fs.existsSync(dbPath)) {
                console.log('MIGRATION 02_migrate2nedb.js: nothing to migrate.');
                return resolve();
            }

            try {
                fs.readdirSync(dbPath).forEach(item => {
                    const dirPath = path.resolve(dbPath, item);
                    if (!fs.statSync(dirPath).isDirectory()) return;

                    if (fs.readdirSync(dirPath).length === 0) {
                        fs.rmSync(dirPath, { recursive: true, force: true });
                        console.log(`Removed empty directory: ${dirPath}`);
                        return;
                    }

                    fs.readdirSync(dirPath).forEach(item => {
                        const filePath = path.resolve(dirPath, item);
                        const fileStat = fs.statSync(filePath);
                        const timestamp = new Date(fileStat.ctime).getTime();
                        const key = path.basename(filePath);
                        // get data and insert into nedb
                        const data = fs.readFileSync(filePath, 'utf8');
                        const encrypted = JSON.parse(data).encrypted;
                        const entry = { key, timestamp, encrypted };
                        console.log(`Inserting secret: ${key}`);
                        nedb.insert(entry, function (err) {
                            if (err) console.error(`Could not migrate secret ${key}:`, err.message);
                        });
                        // clean up file and empty directory
                        fs.rmSync(filePath, { recursive: true, force: true });
                        if (fs.readdirSync(dirPath).length === 0) {
                            fs.rmSync(dirPath, { recursive: true, force: true });
                            console.log(`Removed empty directory: ${dirPath}`);
                        }
                    });
                });
            } catch (err) {
                return reject(err);
            }

            console.log('MIGRATION 02_migrate2nedb.js: finish migration to nedb.');
            resolve();
        });
    },

    down: function () {
        return Promise.reject(new Error('02_migrate2nedb.js cannot be reverted'));
    }
};
