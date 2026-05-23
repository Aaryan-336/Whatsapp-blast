#!/usr/bin/env bash
# exit on error
set -o errexit

# Install backend dependencies
npm install

# Download Chromium binary for Puppeteer on Render
export PUPPETEER_CACHE_DIR=/opt/render/.cache/puppeteer
echo "Downloading Chrome binary for Puppeteer..."
npx puppeteer browsers install
