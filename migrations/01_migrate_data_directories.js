'use strict';

const fs = require('fs');
const path = require('path');
const dir = path.resolve(__dirname, '../data');

function isEmpty(target) {
  return fs.readdirSync(target).length === 0;
}

function move(srcPath, dstPath) {
  try {
    fs.renameSync(srcPath, dstPath);
  } catch (e) {
    // rename fails across devices, fall back to copy + unlink
    fs.cpSync(srcPath, dstPath, { recursive: true });
    fs.rmSync(srcPath, { recursive: true, force: true });
  }
  console.log('Moved "' + srcPath + '" -> "' + dstPath + '"');
}

module.exports = {
  up: function () {
    return new Promise(function (resolve) {
      console.log("MIGRATION 01_migrate_data_directories.js: Migrating old long data directories to 3 character directories.");
      // rename data directories to the 3 characters

      if (!fs.existsSync(dir)) return resolve();

      fs.readdirSync(dir).forEach(it => {
        const itsPath = path.resolve(dir, it);

        if (!fs.statSync(itsPath).isDirectory()) return;

        if (isEmpty(itsPath)) {
          fs.rmSync(itsPath, { recursive: true, force: true });
          console.log('Removed empty directory:  ' + itsPath);
          return;
        }

        const lastPath = path.basename(itsPath);
        if (lastPath.length <= 3) return;

        const shortendPath = itsPath.replace(lastPath, lastPath.substr(0, 3));
        if (fs.existsSync(shortendPath)) {
          // Move all files to shortend path
          fs.readdirSync(itsPath).forEach(it => {
            const srcPath = path.resolve(itsPath, it);
            const dstPath = path.join(shortendPath, path.basename(srcPath));
            if (fs.existsSync(dstPath)) {
              console.warn("File '" + dstPath + "' exists. Overwriting it!");
            }
            move(srcPath, dstPath);
          });
          if (isEmpty(itsPath)) {
            fs.rmSync(itsPath, { recursive: true, force: true });
            console.log('Removed empty directory:  ' + itsPath);
          }
        } else {
          move(itsPath, shortendPath);
        }
      });

      resolve();
    });
  },

  down: function () {
    return Promise.reject(new Error('01_migrate_data_directories.js cannot be reverted'));
  }
};
