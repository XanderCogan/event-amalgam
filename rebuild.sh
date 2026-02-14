#!/bin/bash
# Run from project root. For cron: 0 0 * * * /path/to/sf-event-agg/rebuild.sh
cd "$(dirname "$0")"
npm run build
