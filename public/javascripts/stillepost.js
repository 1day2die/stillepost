/*
 * Client side crypto for stille post.
 *
 * The plain text never leaves the browser: it is encrypted with AES-256-GCM
 * before it is sent, and the key lives only in the URL fragment. A fragment is
 * never transmitted to the server, so neither the server nor any proxy or log
 * in between ever sees the key.
 */
(function () {
	'use strict';

	var KEY_BYTES = 32;
	var IV_BYTES = 12;
	var MAX_MESSAGE_LENGTH = 4000;

	var app = document.getElementById('app');
	if (!app) return;

	function message(name) {
		return app.getAttribute('data-msg-' + name) || name;
	}

	function el(id) {
		return document.getElementById(id);
	}

	function show(node) {
		if (node) node.hidden = false;
	}

	function hide(node) {
		if (node) node.hidden = true;
	}

	function fail(text) {
		var box = el('error');
		box.textContent = text;
		show(box);
	}

	/* ---------- encoding ---------- */

	function bytesToBinary(bytes) {
		var out = '';
		for (var i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
		return out;
	}

	function binaryToBytes(binary) {
		var bytes = new Uint8Array(binary.length);
		for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
		return bytes;
	}

	function toBase64(bytes) {
		return btoa(bytesToBinary(bytes));
	}

	function fromBase64(text) {
		return binaryToBytes(atob(text));
	}

	function toBase64Url(bytes) {
		return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
	}

	function fromBase64Url(text) {
		var padded = text.replace(/-/g, '+').replace(/_/g, '/');
		while (padded.length % 4) padded += '=';
		return fromBase64(padded);
	}

	/* ---------- crypto ---------- */

	function cryptoAvailable() {
		return !!(window.crypto && window.crypto.subtle && window.isSecureContext);
	}

	async function encrypt(plaintext) {
		var key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: KEY_BYTES * 8 }, true, ['encrypt']);
		var iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
		var ciphertext = new Uint8Array(await crypto.subtle.encrypt(
			{ name: 'AES-GCM', iv: iv }, key, new TextEncoder().encode(plaintext)));
		var rawKey = new Uint8Array(await crypto.subtle.exportKey('raw', key));

		// the IV is not secret, it travels with the ciphertext
		var blob = new Uint8Array(iv.length + ciphertext.length);
		blob.set(iv, 0);
		blob.set(ciphertext, iv.length);

		return { ciphertext: toBase64(blob), key: toBase64Url(rawKey) };
	}

	async function decrypt(ciphertextBase64, keyBase64Url) {
		var blob = fromBase64(ciphertextBase64);
		var iv = blob.slice(0, IV_BYTES);
		var ciphertext = blob.slice(IV_BYTES);
		var key = await crypto.subtle.importKey(
			'raw', fromBase64Url(keyBase64Url), { name: 'AES-GCM' }, false, ['decrypt']);
		// GCM verifies the authentication tag, so a wrong key or a modified
		// ciphertext throws here instead of returning garbage
		var plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, ciphertext);
		return new TextDecoder().decode(plaintext);
	}

	/* ---------- api ---------- */

	function apiUrl(suffix) {
		return app.getAttribute('data-api') + suffix;
	}

	async function apiCreate(ciphertext) {
		var res = await fetch(apiUrl(''), {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ ciphertext: ciphertext })
		});
		if (!res.ok) throw new Error('create failed: ' + res.status);
		return (await res.json()).id;
	}

	async function apiPeek(id) {
		var res = await fetch(apiUrl('/' + id));
		return res.ok;
	}

	async function apiBurn(id) {
		var res = await fetch(apiUrl('/' + id + '/burn'), { method: 'POST' });
		if (!res.ok) return null;
		return (await res.json()).ciphertext;
	}

	/* ---------- the link ---------- */

	function parseFragment() {
		var raw = location.hash.replace(/^#/, '');
		var dot = raw.indexOf('.');
		if (dot < 0) return null;
		var id = raw.slice(0, dot);
		var key = raw.slice(dot + 1);
		if (!/^[0-9a-f]{16}$/.test(id)) return null;
		if (!/^[A-Za-z0-9_-]{43}$/.test(key)) return null;
		return { id: id, key: key };
	}

	function buildLink(id, key) {
		return location.origin + location.pathname + '#' + id + '.' + key;
	}

	function dropFragment() {
		history.replaceState(null, '', location.pathname + location.search);
	}

	/* ---------- create ---------- */

	// the link of the entry that was created last, shared by the copy and the
	// messenger buttons
	var currentLink = '';

	function setUpCreate() {
		var form = el('create-form');
		var input = el('secretUserMessage');
		var button = el('create-button');
		var counter = el('counter');

		setUpShare();

		function updateCounter() {
			var left = MAX_MESSAGE_LENGTH - input.value.length;
			counter.textContent = left + ' / ' + MAX_MESSAGE_LENGTH;
			counter.classList.toggle('warning', left < 10);
		}
		input.addEventListener('input', updateCounter);
		updateCounter();

		form.addEventListener('submit', async function (event) {
			event.preventDefault();
			hide(el('error'));

			var text = input.value;
			if (!text) return;
			if (text.length > MAX_MESSAGE_LENGTH) return fail(message('too-long'));

			button.disabled = true;
			try {
				var encrypted = await encrypt(text);
				var id = await apiCreate(encrypted.ciphertext);

				currentLink = buildLink(id, encrypted.key);
				el('url').value = currentLink;
				// the plain text has served its purpose, do not leave it on screen
				input.value = '';
				updateCounter();
				hide(el('create-fields'));
				show(el('result'));
			} catch (e) {
				fail(message('create-failed'));
			} finally {
				button.disabled = false;
			}
		});
	}

	// bound once, so that creating several entries without a reload does not
	// stack up handlers that all fire on the next click
	function setUpShare() {
		var targets = {
			whatsapp: 'whatsapp://send?text=',
			telegram: 'tg://msg?text=',
			threema: 'threema://compose?text='
		};

		el('copy').addEventListener('click', async function () {
			var field = el('url');
			var copied = false;
			try {
				await navigator.clipboard.writeText(currentLink);
				copied = true;
			} catch (e) {
				field.select();
				copied = document.execCommand('copy');
			}
			// only clear the link once it is safely somewhere else
			if (copied) afterShare();
		});

		Object.keys(targets).forEach(function (name) {
			var button = el('share-' + name);
			if (!button) return;
			button.addEventListener('click', function () {
				window.open(targets[name] + encodeURIComponent(currentLink), '_blank');
				afterShare();
			});
		});
	}

	function afterShare() {
		var box = el('copydelete');
		if (!box || !box.checked) return;
		// leave nothing on screen for the next person looking at it
		currentLink = '';
		el('url').value = '';
		hide(el('result'));
		show(el('create-fields'));
	}

	/* ---------- read ---------- */

	function setUpRead(entry) {
		var button = el('reveal-button');

		apiPeek(entry.id).then(function (exists) {
			if (!exists) return fail(message('no-entry'));
			show(el('reveal'));
		}).catch(function () {
			fail(message('no-entry'));
		});

		button.addEventListener('click', async function () {
			button.disabled = true;
			hide(el('error'));
			try {
				var ciphertext = await apiBurn(entry.id);
				if (ciphertext === null) {
					fail(message('no-entry'));
					return;
				}

				var plaintext = await decrypt(ciphertext, entry.key);

				el('result-text').value = plaintext;
				hide(el('reveal'));
				show(el('revealed'));
				// the entry is gone now, keep the key out of the address bar
				dropFragment();
			} catch (e) {
				fail(message('decrypt-failed'));
			} finally {
				button.disabled = false;
			}
		});
	}

	/* ---------- faq ---------- */

	function setUpFaq() {
		var toggle = el('faq');
		var container = el('faqContainer');
		if (!toggle || !container) return;
		toggle.addEventListener('click', function (event) {
			event.preventDefault();
			container.hidden = !container.hidden;
		});
	}

	/* ---------- boot ---------- */

	setUpFaq();

	if (!cryptoAvailable()) {
		hide(el('view-create'));
		fail(message('crypto-unavailable'));
		return;
	}

	var entry = parseFragment();
	if (entry) {
		hide(el('view-create'));
		show(el('view-read'));
		setUpRead(entry);
	} else if (location.hash.length > 1) {
		hide(el('view-create'));
		fail(message('no-entry'));
	} else {
		show(el('view-create'));
		setUpCreate();
	}
})();
