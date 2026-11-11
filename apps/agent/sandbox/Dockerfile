# The container an agent's bash commands run in. /workspace is mounted from R2 (S3Mount), so it
# needs fuse3 and s3fs, and the sandbox shim of the same version as @cloudflare/sandbox.
FROM node:24-trixie-slim

RUN apt-get update \
	&& apt-get install -y --no-install-recommends ca-certificates fuse3 s3fs python3 jq git \
	&& rm -rf /var/lib/apt/lists/*

COPY --from=docker.io/cloudflare/sandbox:1.0.3 /usr/local/bin/sandbox-shim /usr/local/bin/sandbox-shim

RUN mkdir /workspace
CMD ["sleep", "infinity"]
