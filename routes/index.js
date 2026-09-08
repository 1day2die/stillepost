const legacy = require('./legacy');

exports.index = function (req, res) {
	// links handed out before the switch to end to end encryption
	if (legacy.isLegacyLink(req)) return legacy.read(req, res);

	res.render('index', {});
};
