read2burn
=========

A simple application for more secure password transportation. The entry is
encrypted **in the browser**, the server only ever stores ciphertext it cannot
read. Accessing the link displays the entry and removes it at the same time.

How the link protects the entry
-------------------------------

    https://host/#<entry id>.<encryption key>
                 ^-------------------------^
                 the fragment, which a browser never sends to a server

* The browser generates a random 256 bit key and encrypts with AES-256-GCM.
* Only the ciphertext is sent to the server. The key stays in the fragment.
* Because a fragment is never transmitted, the key appears in no access log, no
  proxy, and no `Referer` header.
* GCM is authenticated: a wrong key or a modified ciphertext is rejected
  instead of producing garbage.

The link can be sent by email and the email can be archived without
compromising the secret entry (of course only if it has been accessed by the
recipient once).

Because the encryption happens in the browser, JavaScript and a secure context
(https, or localhost during development) are required.

Please have a look at https://www.read2burn.com/


Dependencies
============

nodejs >= 20, npm, git


Install
=======

Install the application.

    git clone https://github.com/wemove/read2burn.git

Load the required modules.

    npm ci

Start the application.

    node app.js


Configuration
=============

| Variable      | Default    | Meaning                                        |
|---------------|------------|------------------------------------------------|
| `PORT`        | `3300`     | port to listen on                              |
| `TRUST_PROXY` | `loopback` | which proxy addresses may set forwarding headers |

Entries expire after 100 days; a daily job removes them.

Links created before the switch to browser side encryption carry their key in
the query string and are still readable through `routes/legacy.js`. That file,
`views/legacy.ejs` and the `isLegacyLink()` branch in `routes/index.js` can be
deleted 100 days after this version went live.
