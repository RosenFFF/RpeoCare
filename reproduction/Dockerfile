FROM mcr.microsoft.com/playwright:v1.63.0-noble

WORKDIR /opt/repocare

RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    git python3 python3-pytest python3-pip python3-setuptools python3-wheel golang-go \
  && rm -rf /var/lib/apt/lists/* \
  && npm init -y >/dev/null 2>&1 \
  && npm install --omit=dev playwright@1.63.0 \
  && useradd --create-home --uid 10001 --shell /usr/sbin/nologin repocare

COPY runner.mjs /opt/repocare/runner.mjs
COPY commands.mjs /opt/repocare/commands.mjs

USER repocare
ENTRYPOINT ["node", "/opt/repocare/runner.mjs"]
