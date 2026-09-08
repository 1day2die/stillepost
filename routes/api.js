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
	const ciphertext = req.body ? req.body.ciphertext : undefined;

	if (typeof ciphertext !== 'string'
		|| ciphertext.length < MIN_CIPHERTEXT_LENGTH
		|| ciphertext.length > MAX_CIPHERTEXT_LENGTH
		|| !BASE64_PATTERN.test(ciphertext)) {
		return res.status(400).json({ error: 'invalid_ciphertext' });
	}

	generateUniqueId(1, function (err, id) {
		if (err) {
			console.error('Could not generate an id:', err.message);
			return res.status(500).json({ error: 'internal' });
		}
		app.nedb.insert({ key: id, timestamp: Date.now(), encrypted: ciphertext, v: SCHEME_VERSION }, function (err) {
			if (err) {
				console.error('Could not store the entry:', err.message);
				return res.status(500).json({ error: 'internal' });
			}
			counter.countMessage();
			res.status(201).json({ id });
		});
	});
};

exports.peek = function (req, res) {
	const id = req.params.id;
	if (!ID_PATTERN.test(id)) return res.status(404).json({ error: 'not_found' });

	app.nedb.findOne({ key: id, v: SCHEME_VERSION }, function (err, doc) {
		if (err) {
			console.error('Could not look up the entry:', err.message);
			return res.status(500).json({ error: 'internal' });
		}
		if (!doc) return res.status(404).json({ error: 'not_found' });
		res.json({ exists: true });
	});
};

exports.burn = function (req, res) {
	const id = req.params.id;
	if (!ID_PATTERN.test(id)) return res.status(404).json({ error: 'not_found' });

	app.nedb.findOne({ key: id, v: SCHEME_VERSION }, function (err, doc) {
		if (err) {
			console.error('Could not look up the entry:', err.message);
			return res.status(500).json({ error: 'internal' });
		}
		if (!doc) return res.status(404).json({ error: 'not_found' });

		// delete before handing anything out: nedb serialises its operations, so
		// of two concurrent readers exactly one sees numRemoved === 1 and gets
		// the ciphertext. The other one is told the entry is gone.
		app.nedb.remove({ _id: doc._id }, {}, function (err, numRemoved) {
			if (err) {
				console.error('Could not remove the entry:', err.message);
				return res.status(500).json({ error: 'internal' });
			}
			if (numRemoved !== 1) return res.status(404).json({ error: 'not_found' });
			app.nedb.compactDatafile();
			res.json({ ciphertext: doc.encrypted });
		});
	});
};
