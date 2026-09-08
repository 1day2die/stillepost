#!/usr/bin/env node
/**
 * Module dependencies.
 */
const express = require('express')
    , routes = require('./routes')
    , api = require('./routes/api')
    , http = require('http')
    , path = require('path')
    , fs = require('fs')
    , Umzug = require('umzug')
    , cron = require('node-cron')
    , rateLimit = require('express-rate-limit')
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
// only trust forwarding headers from the reverse proxy, otherwise any client
// can spoof its address and slip past the rate limits
app.set('trust proxy', process.env.TRUST_PROXY || 'loopback');
app.disable('x-powered-by');

app.use(function securityHeaders(req, res, next) {
    // a page can carry a decrypted secret, so it must never be stored anywhere
    res.setHeader('Cache-Control', 'no-store');
    // keeps the fragment (and with it the key) out of outgoing requests
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', [
        "default-src 'none'",
        "script-src 'self'",
        "style-src 'self'",
        "img-src 'self'",
        "font-src 'self'",
        "connect-src 'self'",
        "form-action 'self'",
        "base-uri 'none'",
        "frame-ancestors 'none'"
    ].join('; '));
    if (req.secure) {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
});

app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders: function (res) {
        // Static assets carry no secrets, but stillepost.js does the actual
        // encryption: a stale copy after a deploy would keep running old crypto
        // code. "no-cache" still allows a cheap 304, it only forbids using a
        // cached copy without asking.
        res.setHeader('Cache-Control', 'no-cache');
    }
}));

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

const limit = function (windowMinutes, max) {
    return rateLimit({
        windowMs: windowMinutes * 60 * 1000,
        limit: max,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        message: { error: 'rate_limited' }
    });
};

const createLimiter = limit(15, 60);
const readLimiter = limit(15, 300);

app.get('/', routes.index);
// legacy links are submitted as a form post, see routes/legacy.js
app.post('/', express.urlencoded({ extended: false, limit: '8kb' }), readLimiter, routes.index);

app.post('/api/entries', createLimiter, express.json({ limit: '64kb' }), api.create);
app.get('/api/entries/:id', readLimiter, api.peek);
app.post('/api/entries/:id/burn', readLimiter, api.burn);

// anything else: back to the form instead of an unhandled 404
app.use(function (req, res) {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'not_found' });
    res.status(404).render('index', {});
});

// last resort: make sure a failing request always gets an answer
app.use(function (err, req, res, next) {
    if (res.headersSent) return next(err);

    // body-parser reports malformed or oversized bodies with a 4xx status of
    // its own; only anything else is a real server side failure worth logging
    const status = err && Number(err.status || err.statusCode);
    const clientError = status >= 400 && status < 500;
    if (!clientError) {
        console.error('Unhandled error while serving', req.method, req.path, '-', err && err.message);
    }
    const code = clientError ? status : 500;
    const body = code === 413 ? 'too_large' : (clientError ? 'bad_request' : 'internal');

    if (req.path.startsWith('/api/')) return res.status(code).json({ error: body });
    res.status(code).render('index', {});
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
