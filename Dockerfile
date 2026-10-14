FROM rust:1-bookworm AS prover
RUN rustup toolchain install nightly --profile minimal
COPY server/artifact /artifact
ENV CARGO_TARGET_DIR=/build
WORKDIR /artifact
RUN cargo +nightly build --release --locked --manifest-path control-plane/zkroute/rust/Cargo.toml --bin veriroute_route
RUN cargo +nightly build --release --locked --manifest-path data-plane/zkrewrite/rust/Cargo.toml --bin rewrite_demo
RUN cargo +nightly build --release --locked --manifest-path data-plane/signature/rust/Cargo.toml --bin veriroute-signature-tools

FROM node:22-bookworm-slim AS website
WORKDIR /site
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=website /site/dist ./dist
COPY scripts/serve.mjs ./scripts/serve.mjs
COPY server/api.mjs server/prove.py ./server/
COPY --from=prover /artifact /artifact
COPY --from=prover /build/release/veriroute_route /build/release/rewrite_demo /build/release/veriroute-signature-tools ./bin/release/
RUN mkdir -p /var/lib/verirouter && chown node:node /var/lib/verirouter
ENV HOST=0.0.0.0 PORT=8080 VERIROUTER_ARTIFACT_DIR=/artifact CARGO_TARGET_DIR=/app/bin PROVER_STATE_DIR=/var/lib/verirouter PROVER_THREADS=8
USER node
VOLUME /var/lib/verirouter
EXPOSE 8080
CMD ["node", "scripts/serve.mjs", "dist"]
