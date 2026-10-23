# Everyday tasks for the dashboard, the kiosk APK and the repo checks.
# Device and flashing scripts are left out on purpose: run those by hand, one step at a time
# (README.md -> "For agents: start here").
import? 'local.just'

set positional-arguments

dash := "dashboard"

# List the recipes
default:
    @just --list --unsorted

# Install the dashboard's npm dependencies
install:
    cd {{dash}} && npm install

# Home server + Vite together, restarting the server on server/ changes
dev-all:
    cd {{dash}} && npm run dev:all

# Vite only, served on the LAN so a frame can load it
dev:
    cd {{dash}} && npm run dev

# Home server only on :8080 (needs dashboard/config/ and a writable dashboard/data/)
server:
    cd {{dash}} && npm run server

# Build the dashboard into dashboard/dist
build:
    cd {{dash}} && npm run build

# Serve the built dashboard/dist
preview: build
    cd {{dash}} && npm run preview

# Dashboard and home-server tests
test:
    cd {{dash}} && npm test

# Python script tests (synthetic fakes, never touch USB or devices)
test-py:
    #!/usr/bin/env bash
    set -euo pipefail
    for t in scripts/test-backup-flash.py scripts/test-extract-partitions.py \
             scripts/aimor-network-adb/test-dns.py scripts/aimor-network-adb/test-protocol.py \
             scripts/zc002-fel/test_fel_read.py scripts/zc002-fel/test_prepare_root.py \
             scripts/zc002-fel/test_spl_reader.py; do
        echo "== $t"
        python3 "$t"
    done

# Every test: dashboard, Python scripts, kiosk navigation
test-all: test test-py kiosk-test

# Pre-push checks (conflict markers, links, syntax, server tests, kiosk build, privacy sweep)
check base="origin/main":
    .agents/skills/triage-contributions/scripts/checks.sh {{base}}

# Build and deploy the dashboard to Cloudflare
deploy:
    cd {{dash}} && npm run deploy

# Build the kiosk APK (needs ANDROID_HOME, JDK 17); `just kiosk site` bundles dashboard/dist
kiosk site="":
    {{ if site == "site" { "KIOSK_SITE=dashboard/dist " } else { "" } }}bash {{dash}}/kiosk/build.sh

# Host-only test of the kiosk's navigation logic (needs a JDK)
kiosk-test:
    python3 {{dash}}/kiosk/test-navigation.py

# Save the kiosk's URL on a connected frame, or print the saved one with no argument
kiosk-url *url:
    scripts/set-kiosk-url.sh "$@"
