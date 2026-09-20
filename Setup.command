#!/bin/bash
# Double-click me (first time: right-click > Open) to set up imsg-to-discord.
cd "$(dirname "$0")" || exit 1
bash ./setup.sh
status=$?
echo
read -n 1 -s -r -p "Press any key to close this window..."
exit $status
