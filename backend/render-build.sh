#!/usr/bin/env bash
# exit on error
set -o errexit

# Install backend dependencies
npm install

# Download Chromium binary for Puppeteer on Render
echo "Downloading Chrome binary for Puppeteer..."
npx puppeteer browsers install chrome
