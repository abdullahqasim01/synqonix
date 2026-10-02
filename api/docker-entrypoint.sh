#!/bin/sh
set -e
# Apply pending migrations before starting; set SKIP_MIGRATIONS=1 when a separate job does it.
if [ "$SKIP_MIGRATIONS" != "1" ]; then
  npx prisma migrate deploy
fi
exec "$@"
