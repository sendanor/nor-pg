#!/bin/bash -x

test="$1"

set -e

function finish {
	./node_modules/.bin/nor-pgrunner destroy
}
trap finish EXIT

export DEBUG_NOPG=true
export NOPG_TIMEOUT=2000
export PGCONFIG="$(./node_modules/.bin/nor-pgrunner create)"

echo 'PGCONFIG="'"$PGCONFIG"'"'

psql "$PGCONFIG" < scripts/test-tables.sql;

if test "x$test" = x; then
	npm -s test
else
	npm -s run test-spec -- --grep "$test"
fi
