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

Note: the current access URL keeps the key in the fragment, which is never sent
to the server, so nothing secret reaches the access log. Links created before
that change carry their key in the query string and are still valid for 100
days - until they have expired, keep the query string out of the access log:

    log_format r2b '$remote_addr - $remote_user [$time_local] '
                   '"$request_method $uri $server_protocol" '
                   '$status $body_bytes_sent "$http_referer" "$http_user_agent"';
