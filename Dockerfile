FROM node:24.13.0-bookworm AS deps

WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-venv python3-pip \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json requirements.txt ./
RUN npm ci
RUN python3 -m venv /app/.venv \
  && /app/.venv/bin/python -m pip install --upgrade pip \
  && /app/.venv/bin/python -m pip install -r requirements.txt

FROM deps AS builder
COPY . .
RUN npm run build

FROM node:24.13.0-bookworm AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV CAD_RUNNER_COMMAND="/app/.venv/bin/python scripts/run_build123d.py"

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app /app
RUN mkdir -p /app/outputs/cad /app/logs

EXPOSE 3000
CMD ["npm", "run", "start"]
