FROM node:24.13.0-bookworm AS deps
ARG APT_MIRROR=http://deb.debian.org/debian
ARG APT_SECURITY_MIRROR=http://deb.debian.org/debian-security
ARG PIP_INDEX_URL=https://pypi.org/simple

WORKDIR /app
RUN sed -i "s|http://deb.debian.org/debian-security|${APT_SECURITY_MIRROR}|g; s|http://deb.debian.org/debian|${APT_MIRROR}|g" /etc/apt/sources.list.d/debian.sources
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    libegl1 \
    libgl1 \
    libsm6 \
    libxext6 \
    libxrender1 \
    python3 \
    python3-pip \
    python3-venv \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json requirements.txt ./
RUN npm ci
RUN python3 -m venv /app/.venv \
  && /app/.venv/bin/python -m pip install --upgrade pip \
  && /app/.venv/bin/python -m pip install --index-url "$PIP_INDEX_URL" -r requirements.txt

FROM deps AS builder
COPY . .
RUN npm run build

FROM builder AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV CAD_RUNNER_COMMAND="/app/.venv/bin/python scripts/run_build123d.py"

RUN mkdir -p /app/outputs/cad /app/logs

EXPOSE 3000
CMD ["npm", "run", "start"]
