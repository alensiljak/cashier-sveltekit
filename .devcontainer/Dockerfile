# Cashier development container

FROM mcr.microsoft.com/devcontainers/typescript-node:4-24-trixie

# To install additional packages, add them to the list in the command below:
RUN apt-get update && apt-get install -y \
    mkcert \
    libnss3-tools \
    && rm -rf /var/lib/apt/lists/*
