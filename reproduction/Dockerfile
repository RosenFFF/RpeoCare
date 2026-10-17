FROM mcr.microsoft.com/playwright:v1.63.0-noble

WORKDIR /opt/repocare

RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    git python3 python3-venv golang-go \
  && rm -rf /var/lib/apt/lists/* \
  && npm init -y >/dev/null 2>&1 \
  && npm install --omit=dev playwright@1.63.0 \
  && useradd --create-home --uid 10001 --shell /usr/sbin/nologin repocare

COPY python-requirements.txt /opt/repocare/python-requirements.txt
RUN python3 -m venv /opt/repocare/python \
  && /opt/repocare/python/bin/python -m pip install --no-cache-dir --only-binary=:all: --require-hashes -r /opt/repocare/python-requirements.txt \
  && /opt/repocare/python/bin/python -m pip check
ENV PATH="/opt/repocare/python/bin:${PATH}"

COPY runner.mjs /opt/repocare/runner.mjs
COPY commands.mjs /opt/repocare/commands.mjs
COPY preflight.py /opt/repocare/preflight.py
COPY dependency-snapshot.py /opt/repocare/dependency-snapshot.py

USER repocare
ENTRYPOINT ["node", "/opt/repocare/runner.mjs"]
