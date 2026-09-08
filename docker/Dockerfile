####################
# Build application

# pinned on purpose: nedb/older deps break on Node major upgrades, so an
# unpinned "lts" tag can turn a routine rebuild into a broken deployment
FROM node:24-alpine AS builder

ENV READ2BURN_HOME="/app"

WORKDIR ${READ2BURN_HOME}

# build from THIS working copy, not from a remote branch, so the image
# actually contains the code that was reviewed and tested
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY app.js ./
COPY lib ./lib
COPY routes ./routes
COPY views ./views
COPY public ./public
COPY locales ./locales
COPY migrations ./migrations
COPY LICENSE ./

####################
# Create image

FROM node:24-alpine

LABEL maintainer="J Mueller <joachim.mueller@wemove.com>"

ENV READ2BURN_HOME="/app"
ENV NODE_ENV="production"

WORKDIR ${READ2BURN_HOME}

RUN apk add --no-cache tzdata

COPY --from=builder --chown=node:node ${READ2BURN_HOME} .

# the app writes read2burn.db, count.json and umzug.json here
RUN mkdir -p ${READ2BURN_HOME}/data && chown -R node:node ${READ2BURN_HOME}

USER node

EXPOSE 3300

VOLUME ["${READ2BURN_HOME}/data"]

CMD ["node", "app.js"]
