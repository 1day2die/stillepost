#!/usr/bin/env node
/**
 * Module dependencies.
 */
const express = require('express')
    , routes = require('./routes')
    , http = require('http')
    , path = require('path')
    , fs = require('fs')
    , Umzug = require('umzug')
    , cron = require('node-cron')
    , Datastore = require('@seald-io/nedb');

const app = express();
const i18n = require("i18n");

// all runtime state lives here; resolved against the app directory, not the
// current working directory, so the app can be started from anywhere
const DATA_DIR = path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const umzug = new Umzug({
    storage: 'json',
    // keep the migration state next to the data it describes, so it survives
    // a container recreate instead of replaying on every start
    storageOptions: { path: path.join(DATA_DIR, 'umzug.json') },
    migrations: { path: path.join(__dirname, 'migrations') }
});

// default: using 'accept-language' header to guess language settings
app.use(i18n.init);
app.set('port', process.env.PORT || 3300);
app.set('views', __dirname + '/views');
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: false, limit: '64kb' }));
app.enable('trust proxy');
app.disable( 'x-powered-by' )

const nedb = new Datastore({filename: path.join(DATA_DIR, 'read2burn.db'), autoload: true});

module.exports.nedb = nedb;
module.exports.DATA_DIR = DATA_DIR;

i18n.configure({
    locales: ['en', 'de'],
    directory: __dirname + '/locales',
    defaultLocale: 'en',
    // never write to the source tree at runtime (breaks on read-only volumes)
    updateFiles: false
});

app.get('/', routes.index);
app.post('/', routes.index);

// anything else: back to the form instead of an unhandled 404
app.use(function (req, res) {
    res.status(404).render('index', { url: '', secretUserMessage: '', error: undefined, found: false });
});

// last resort: make sure a failing request always gets an answer
app.use(function (err, req, res, next) {
    if (res.headersSent) return next(err);
    if (err && (err.type === 'entity.too.large' || err.status === 413)) {
        return res.status(413).render('index', { url: '', secretUserMessage: '', error: 'ERR_TOO_LONG', found: false });
    }
    console.error('Unhandled error while serving', req.method, req.path, '-', err && err.message);
    res.status(500).render('index', { url: '', secretUserMessage: '', error: 'ERR_INTERNAL', found: false });
});

umzug.up().then(function (migrations) {
    // "migrations" will be an Array with the names of the
    // executed migrations.
}).catch(function (err) {
    console.error('Migration failed:', err);
});

// start server
const server = http.createServer(app);
// drop sockets that go idle, so a stuck request cannot pin a connection forever
server.setTimeout(60000);
server.listen(app.get('port'), function () {
    console.log("Express server listening on port " + app.get('port'));
});

// schedule regular cleanup
cron.schedule('12 1 * * *', function () {
    console.log("Cleanup proceeding...")
    const expireTime = new Date().getTime() - 8640000000;
    nedb.remove({timestamp: {$lte: expireTime}}, { multi: true }, function(err, numDeleted) {
        if (err) {
            console.error('Cleanup failed:', err);
            return;
        }
        console.log('Deleted', numDeleted, 'entries');
        nedb.compactDatafile();
    });
});
