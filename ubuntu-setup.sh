#!/bin/bash
set -eu

# Retired installer: the old database and bootstrap assumptions were unsafe.
printf '%s\n' \
  "The legacy Ubuntu installer is retired for v0.1.0-alpha." \
  "Use the README.md quickstart and UBUNTU-QUICKSTART.md for local setup." \
  "Rovelink is not production-ready. No system or configuration changes were made."
exit 1
