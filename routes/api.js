/*
 * JSON API for the end to end encrypted flow.
 *
 * The server only ever sees opaque ciphertext. It cannot decrypt an entry,
 * because the key never leaves the browser.
 */
const crypto = require('crypto');
const app = require('../app');
const counter = require('../lib/counter');

const ID_BYTES = 8;
const ID_PATTERN = /^[0-9a-f]{16}$/;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
// 12 byte IV + 16 byte tag + payload, base64 encoded
const MIN_CIPHERTEXT_LENGTH = 40;
const MAX_CIPHERTEXT_LENGTH = 32 * 1024;
const MAX_ID_ATTEMPTS = 5;
// how often a single link may be opened at most
const MAX_VIEWS = 20;
// marks entries of the end to end encrypted scheme, see routes/legacy.js
const SCHEME_VERSION = 2;

function generateUniqueId(attempt, callback) {
	const id = crypto.randomBytes(ID_BYTES).toString('hex');
	app.nedb.findOne({ key: id }, function (err, doc) {
		if (err) return callback(err);
		if (!doc) return callback(null, id);
		if (attempt >= MAX_ID_ATTEMPTS) return callback(new Error('No unique id found'));
		generateUniqueId(attempt + 1, callback);
	});
}

exports.create = function (req, res) {
	const body = req.body || {};
	const ciphertext = body.ciphertext;

	if (typeof ciphertext !== 'string'
		|| ciphertext.length < MIN_CIPHERTEXT_LENGTH
		|| ciphertext.length > MAX_CIPHERTEXT_LENGTH
		|| !BASE64_PATTERN.test(ciphertext)) {
		return res.status(400).json({ error: 'invalid_ciphertext' });
	}

	// how many times the link may be opened; a missing value keeps the old
	// behaviour of a single view
	const views = body.views === undefined ? 1 : body.views;
	if (!Number.isInteger(views) || views < 1 || views > MAX_VIEWS) {
		return res.status(400).json({ error: 'invalid_views' });
	}

	generateUniqueId(1, function (err, id) {
		if (err) {
			console.error('Could not generate an id:', err.message);
			return res.status(500).json({ error: 'internal' });
		}
		// "remaining" counts down and is what the burn guard compares against;
		// the number of accesses so far is threshold - remaining
		const entry = {
			key: id,
			timestamp: Date.now(),
			encrypted: ciphertext,
			v: SCHEME_VERSION,
			threshold: views,
			remaining: views
		};
		app.nedb.insert(entry, function (err) {
			if (err) {
				console.error('Could not store the entry:', err.message);
				return res.status(500).json({ error: 'internal' });
			}
			counter.countMessage();
			res.status(201).json({ id, threshold: views });
		});
	});
};

exports.peek = function (req, res) {
	const id = req.params.id;
	if (!ID_PATTERN.test(id)) return res.status(404).json({ error: 'not_found' });

	app.nedb.findOne({ key: id, v: SCHEME_VERSION, remaining: { $gt: 0 } }, function (err, doc) {
		if (err) {
			console.error('Could not look up the entry:', err.message);
			return res.status(500).json({ error: 'internal' });
		}
		if (!doc) return res.status(404).json({ error: 'not_found' });
		res.json({ exists: true, threshold: doc.threshold, remaining: doc.remaining });
	});
};

exports.burn = function (req, res) {
	const id = req.params.id;
	if (!ID_PATTERN.test(id)) return res.status(404).json({ error: 'not_found' });

	// One atomic step: only an entry that still has views left is decremented.
	// nedb runs its operations one after another, so of several concurrent
	// readers exactly as many succeed as there were views left - nobody can
	// slip through by racing.
	app.nedb.update(
		{ key: id, v: SCHEME_VERSION, remaining: { $gt: 0 } },
		{ $inc: { remaining: -1 } },
		{ returnUpdatedDocs: true },
		function (err, numAffected, doc) {
			if (err) {
				console.error('Could not claim the entry:', err.message);
				return res.status(500).json({ error: 'internal' });
			}
			if (numAffected !== 1 || !doc) return res.status(404).json({ error: 'not_found' });

			const deliver = function () {
				res.json({
					ciphertext: doc.encrypted,
					threshold: doc.threshold,
					remaining: doc.remaining
				});
			};

			// still views left, keep the entry
			if (doc.remaining > 0) return deliver();

			// last view: remove it. Should that fail, the entry stays behind with
			// remaining === 0 and the guard above already makes it unreadable, so
			// the reader can still be served and the cleanup job takes care of it.
			app.nedb.remove({ _id: doc._id }, {}, function (err) {
				if (err) console.error('Could not remove the used up entry:', err.message);
				app.nedb.compactDatafile();
				deliver();
			});
		}
	);
};
