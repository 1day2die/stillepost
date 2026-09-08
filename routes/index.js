const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const app = require('../app');

const CIPHER_ALGORITHM = 'aes-256-cbc';
const ERR_NO_SUCH_ENTRY = 'ERR_NO_SUCH_ENTRY';
const ERR_INTERNAL = 'ERR_INTERNAL';
const ERR_TOO_LONG = 'ERR_TOO_LONG';
const PASSWORD_KEY_LENGTH = 32;
const UNIQUE_KEY_LENGTH = 8;
// key + password + IV, all hex encoded
const SECRET_LENGTH = (UNIQUE_KEY_LENGTH * 2) + (PASSWORD_KEY_LENGTH * 2) + 32;
const MAX_MESSAGE_LENGTH = 8000;
const MAX_KEY_ATTEMPTS = 5;

// resolved lazily: app.js requires this module before its exports are set
function counterFile() {
	return path.join(app.DATA_DIR, 'count.json');
}

/**
 * Bookkeeping only - must never be able to break a request.
 */
function countMessage() {
	try {
		const file = counterFile();
		let counter = { messages_created: 0 };
		try {
			counter = JSON.parse(fs.readFileSync(file, 'utf8'));
		} catch (e) {
			// missing or corrupt: start a fresh counter
		}
		counter.messages_created = (Number(counter.messages_created) || 0) + 1;
		fs.writeFileSync(file, JSON.stringify(counter));
	} catch (e) {
		console.error('Could not update the message counter:', e.message);
	}
}

/**
 * Generates a key that is not in use yet. The uniqueness check is asynchronous,
 * so the result can only be delivered through the callback.
 */
function generateUniqueKey(len, attempt, callback) {
	const key = crypto.randomBytes(len).toString('hex');
	app.nedb.findOne({ key }, function (err, doc) {
		if (err) return callback(err);
		if (!doc) return callback(null, key);
		console.log('Key already exists, generating another one');
		if (attempt >= MAX_KEY_ATTEMPTS) return callback(new Error('No unique key found'));
		generateUniqueKey(len, attempt + 1, callback);
	});
}

exports.index = function (req, res, next) {
	const render = function (status, locals) {
		res.status(status).render('index', Object.assign(
			{ url: '', secretUserMessage: '', error: undefined, found: false }, locals));
	};

	const secretUserMessage = req.body ? req.body.secretUserMessage : undefined;
	const submittedKey = (req.query && req.query.key) || (req.body && req.body.key);

	if (typeof secretUserMessage === 'string' && secretUserMessage.length > 0) {
		if (secretUserMessage.length > MAX_MESSAGE_LENGTH) {
			return render(413, { error: ERR_TOO_LONG, secretUserMessage: '' });
		}

		generateUniqueKey(UNIQUE_KEY_LENGTH, 1, function (err, key) {
			if (err) {
				console.error('Could not generate a key:', err.message);
				return render(500, { error: ERR_INTERNAL });
			}

			let encrypted;
			const password = crypto.randomBytes(PASSWORD_KEY_LENGTH).toString('hex');
			const IV = crypto.randomBytes(16); // Generate a new IV for each encryption
			try {
				const cipher = crypto.createCipheriv(CIPHER_ALGORITHM, Buffer.from(password, 'hex'), IV);
				encrypted = cipher.update(secretUserMessage, 'utf8', 'base64') + cipher.final('base64');
			} catch (e) {
				console.error('Could not encrypt the entry:', e.message);
				return render(500, { error: ERR_INTERNAL });
			}

			// the password and the IV are never stored, they only live in the URL
			const entry = { key, timestamp: Date.now(), encrypted };
			app.nedb.insert(entry, function (err) {
				if (err) {
					console.error('Could not store the entry:', err.message);
					return render(500, { error: ERR_INTERNAL });
				}
				countMessage();
				const url = `https://${req.get('host')}/?key=${key}${password}${IV.toString('hex')}`;
				render(200, { url, secretUserMessage });
			});
		});
		return;
	}

	if (submittedKey !== undefined) {
		// reject anything that is not exactly one well formed secret, so that a
		// truncated or manipulated link can never reach the cipher
		if (typeof submittedKey !== 'string' || !new RegExp(`^[0-9a-f]{${SECRET_LENGTH}}$`).test(submittedKey)) {
			return render(404, { error: ERR_NO_SUCH_ENTRY });
		}

		const key = submittedKey.substr(0, UNIQUE_KEY_LENGTH * 2);
		const password = submittedKey.substr(UNIQUE_KEY_LENGTH * 2, PASSWORD_KEY_LENGTH * 2);
		const IV = submittedKey.substr((PASSWORD_KEY_LENGTH * 2) + (UNIQUE_KEY_LENGTH * 2));

		app.nedb.findOne({ key }, function (err, doc) {
			if (err) {
				console.error('Could not look up the entry:', err.message);
				return render(500, { error: ERR_INTERNAL });
			}
			if (!doc || !doc.encrypted) {
				return render(404, { error: ERR_NO_SUCH_ENTRY });
			}
			if (!req.body || !req.body.show) {
				// only show the confirmation, do not burn the entry yet
				return render(200, { found: true, key: submittedKey });
			}

			let decrypted;
			try {
				const decipher = crypto.createDecipheriv(CIPHER_ALGORITHM, Buffer.from(password, 'hex'), Buffer.from(IV, 'hex'));
				decrypted = decipher.update(doc.encrypted, 'base64', 'utf8') + decipher.final('utf8');
			} catch (e) {
				// wrong password or damaged entry: keep it, the real recipient may still come
				return render(404, { error: ERR_NO_SUCH_ENTRY });
			}

			app.nedb.remove({ _id: doc._id }, {}, function (err) {
				if (err) {
					// the entry could not be burned, so do not hand out the plain text
					console.error('Could not remove the entry:', err.message);
					return render(500, { error: ERR_INTERNAL });
				}
				app.nedb.compactDatafile();
				render(200, { secretUserMessage: decrypted, found: true });
			});
		});
		return;
	}

	render(200, {});
};
