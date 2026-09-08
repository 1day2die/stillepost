const path = require('path');
const fs = require('fs');
const app = require('../app');

/**
 * Bookkeeping only - must never be able to break a request.
 */
exports.countMessage = function () {
	try {
		// resolved lazily: app.js requires the routes before its exports are set
		const file = path.join(app.DATA_DIR, 'count.json');
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
};
