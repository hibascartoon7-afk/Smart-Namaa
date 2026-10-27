#!/usr/bin/env bash
# Builds and runs the hub logic tests on a normal computer (needs g++). Run from anywhere: bash firmware/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")"
out="$(mktemp -d)/hub_logic_test"
# C++11 on purpose: older ESP32 Arduino cores compile with -std=gnu++11. The sanitizers catch memory mistakes.
g++ -std=c++11 -Wall -Wextra -pedantic -fsanitize=address,undefined -fno-sanitize-recover=undefined -O1 hub_logic_test.cpp -o "$out"
"$out"
