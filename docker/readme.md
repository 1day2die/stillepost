Build docker image

The build context is the repository root, so that the image is built from this
working copy (`-f docker/Dockerfile .`), not from a remote branch.

```
cd <repository root>
docker build --no-cache -f docker/Dockerfile -t wemove/read2burn:<VERSION> .

# push to wemove docker repository
docker login docker-registry.wemove.com
docker tag wemove/read2burn:<VERSION> docker-registry.wemove.com/wemove/read2burn:<VERSION>
docker push docker-registry.wemove.com/wemove/read2burn:<VERSION>
```

Run the docker

```
docker run --restart=always -d -p 127.0.0.1:3300:3300 \
  --volume=/opt/read2burn/data:/app/data \
  --name read2burn wemove/read2burn:<VERSION>
```

The container runs as the unprivileged `node` user (uid 1000). A bind mounted
data directory has to be writable by that uid:

```
mkdir -p /opt/read2burn/data && chown -R 1000:1000 /opt/read2burn/data
```

Apache config for sub paths

---
    RewriteRule ^/r2b$ %{HTTPS_HOST}/r2b/ [R=permanent,L]
    <Location /r2b/>
            ProxyPass http://localhost:3300/
            ProxyPassReverse http://localhost:3300/
            ProxyPreserveHost On
            RequestHeader set X-Forwarded-Proto "https"
            RequestHeader set X-Forwarded-Ssl on
    </Location>
---

Note: the access URL currently carries the decryption key in the query string,
so the reverse proxy will log it. Until that is changed, exclude the request
line from the access log or disable logging for this vhost.
