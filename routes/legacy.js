/*
 * Read path for links of the old, server side encrypted scheme
 * (https://host/?key=<16 hex id><64 hex password><32 hex iv>).
 *
 * Those links carry the decryption key in the query string and use AES-CBC
 * without authentication, which is exactly what the current scheme fixes. They
 * are kept working only so that links that were already handed out stay
 * readable until they expire.
 *
 * Entries expire after 100 days (see the cleanup job in app.js), so this whole
 * file - together with views/legacy.ejs and the isLegacyLink() branch in
 * routes/index.js - can be deleted 100 days after this version went live.
 */
const crypto = require('crypto');
const app = require('../app');

const CIPHER_ALGORITHM = 'aes-256-cbc';
const PASSWORD_KEY_LENGTH = 32;
const UNIQUE_KEY_LENGTH = 8;
const SECRET_LENGTH = (UNIQUE_KEY_LENGTH * 2) + (PASSWORD_KEY_LENGTH * 2) + 32;
const SECRET_PATTERN = new RegExp(`^[0-9a-f]{${SECRET_LENGTH}}$`);

exports.isLegacyLink = function (req) {
	const submitted = (req.query && req.query.key) || (req.body && req.body.key);
	return typeof submitted === 'string' && SECRET_PATTERN.test(submitted);
};

exports.read = function (req, res) {
	const submitted = (req.query && req.query.key) || (req.body && req.body.key);

	const render = function (status, locals) {
		res.status(status).render('legacy', Object.assign(
			{ secretUserMessage: '', error: undefined, key: '' }, locals));
	};

	const key = submitted.substr(0, UNIQUE_KEY_LENGTH * 2);
	const password = submitted.substr(UNIQUE_KEY_LENGTH * 2, PASSWORD_KEY_LENGTH * 2);
	const IV = submitted.substr((PASSWORD_KEY_LENGTH * 2) + (UNIQUE_KEY_LENGTH * 2));

	// entries of the current scheme carry a version marker and must not be
	// served through this path
	app.nedb.findOne(
		{ key, v: { $exists: false }, timestamp: { $gt: Date.now() - app.ENTRY_TTL_MS } },
		function (err, doc) {
		if (err) {
			console.error('Could not look up the legacy entry:', err.message);
			return render(500, { error: 'ERR_INTERNAL' });
		}
		if (!doc || !doc.encrypted) {
			return render(404, { error: 'ERR_NO_SUCH_ENTRY' });
		}
		if (!req.body || !req.body.show) {
			return render(200, { key: submitted });
		}

		let decrypted;
		try {
			const decipher = crypto.createDecipheriv(
				CIPHER_ALGORITHM, Buffer.from(password, 'hex'), Buffer.from(IV, 'hex'));
			decrypted = decipher.update(doc.encrypted, 'base64', 'utf8') + decipher.final('utf8');
		} catch (e) {
			return render(404, { error: 'ERR_NO_SUCH_ENTRY' });
		}

		app.nedb.remove({ _id: doc._id }, {}, function (err, numRemoved) {
			if (err) {
				console.error('Could not remove the legacy entry:', err.message);
				return render(500, { error: 'ERR_INTERNAL' });
			}
			if (numRemoved !== 1) return render(404, { error: 'ERR_NO_SUCH_ENTRY' });
			app.nedb.compactDatafile();
			render(200, { secretUserMessage: decrypted });
		});
	});
};
