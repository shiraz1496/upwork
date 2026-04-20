#!/bin/bash
cd "$(dirname "$0")"

# Build for Chrome
echo "Building Chrome extension..."
cp manifest.chrome.json manifest.json
zip -r upwork-tracker-chrome.zip manifest.json src/
echo "  -> upwork-tracker-chrome.zip"

# Build for Firefox
echo "Building Firefox extension..."
cp manifest.firefox.json manifest.json
zip -r upwork-tracker-firefox.zip manifest.json src/
echo "  -> upwork-tracker-firefox.zip"

# Restore Chrome as default (for local dev)
cp manifest.chrome.json manifest.json

echo ""
echo "Done! Load in browsers:"
echo "  Chrome:  chrome://extensions -> Load unpacked -> select extension/ folder"
echo "  Firefox: about:debugging#/runtime/this-firefox -> Load Temporary Add-on -> select manifest.json"
echo "  Edge:    edge://extensions -> Load unpacked -> select extension/ folder"
echo "  Brave:   brave://extensions -> Load unpacked -> select extension/ folder"
