/** Extended PostgreSQL bindings for pg module */
"use strict";

var debug = require('nor-debug');
var util = require('util');
var Q = require('q');
var PG = require('pg');
var extend = require('nor-extend');
var is = require('nor-is');

/* Optional newrelic instrumentation support */

var NEW_RELIC_ENABLED = ((''+process.env.NEW_RELIC_ENABLED).toUpperCase() === 'TRUE') ? true : false;
var nr;
if(NEW_RELIC_ENABLED) {
	nr = require('nor-newrelic/src/nr');
}

/* Bindings */
var bindings = {};

function catch_results(defer, err, client, done) {
	if(err) {
		return defer.reject(err);
	}
	defer.resolve({"client":client, "done":done});
}

/** */
function get_connect_callback(defer) {
	if(nr) {
		return nr.nr.createTracer('nor-pg:connect', catch_results.bind(undefined, defer));
	}
	return catch_results.bind(undefined, defer);
}

/** `pg.connect` bindings */
bindings.connect = function(config) {
	var defer = Q.defer();
	PG.connect(config, get_connect_callback(defer) );
	return defer.promise;
};

/** PostgreSQL connection constructor */
function PostgreSQL(config) {
	this.config = config;
	extend.ActionObject.call(this);
}
util.inherits(PostgreSQL, extend.ActionObject);

/* Event listener */
function notification_event_listener(self, msg) {
	self.emit('notification', msg);
}

/** Resolve a promise */
function promise_resolve(defer, err, result) {
	if(err) {
		defer.reject(err);
		return;
	}

	defer.resolve(result);
}

/** Wrap the query with `nr.createTracer()` */
function wrap_nr_query(client) {
	var args = Array.prototype.slice.call(arguments);
	var defer = Q.defer();
	args.push(nr.nr.createTracer('nor-pg:query', promise_resolve.bind(undefined, defer) ));
	client.query.apply(client, args);
	return defer.promise;
}

/** `res` will have properties client and done from pg.connect() */
function handle_res(self, res) {

	var client = res.client;

	var conn = {
		"query": (!nr) ? Q.nfbind(client.query.bind(client)) : wrap_nr_query.bind(undefined, client),
		"done": res.done,
		"client": client
	};

	self._conn = conn;

	// Pass NOTIFY to clients
	if (is.func(self.emit)) {
		debug.assert(self._notification_listener).is('function');
		client.on('notification', self._notification_listener);
	}

	return self;
}

/** Create connection (or take it from the pool) */
PostgreSQL.prototype.connect = function() {
	var self = this;

	if(self._client || self._close_client) {
		throw new TypeError("Connected already?");
	}

	self._notification_listener = notification_event_listener.bind(undefined, self);
	debug.assert(self._notification_listener).is('function');

	return extend.promise([PostgreSQL], bindings.connect(this.config).then(handle_res.bind(undefined, self)));
};

/** Disconnect connection (or actually release it back to pool) */
PostgreSQL.prototype.disconnect = function() {
	var self = this;
	var conn = self._conn;
	var client = conn.client;
	var listener = self._notification_listener;

	if(is.func(listener)) {
		client.removeListener('notification', listener);
		delete self._notification_listener;
	}

	if(is.defined(conn)) {
		conn.done();
		delete self._conn;
	} else {
		debug.warn('called on uninitialized connection -- maybe multiple times?');
	}

	return self;
};

/** Returns value of property `rows` from `result` */
function strip_res(result) {
	return result.rows;
}

/** Internal query transaction */
extend.ActionObject.setup(PostgreSQL, 'query', function(str, params){
	var self = this;
	var conn = self._conn;
	debug.assert(conn).is('object');
	return conn.query(str, params).then(strip_res);
});

/** Start transaction */
PostgreSQL.prototype.start = function() {
	var self = this;
	return self._query('BEGIN').then(function() { return self; });
};

/** Commit transaction */
PostgreSQL.prototype.commit = function() {
	var self = this;
	return self._query('COMMIT').then(function() { return self.disconnect(); });
};

/** Rollback transaction */
PostgreSQL.prototype.rollback = function() {
	var self = this;
	return self._query('ROLLBACK').then(function() { return self.disconnect(); });
};

/** Get new connection and start transaction */
PostgreSQL.start = function(config) {
	var pg = new PostgreSQL(config);
	return pg.connect().start();
};

/** This is a helper function for implementing rollback handler for promise fails.
 * Usage:
 *    var scope = pg.scope();
 *    pg.start(opts.pg).then(pg.scope(scope)).query(...).commit().fail(scope.rollback)
 */
PostgreSQL.scope = function(where) {
	if(where === undefined) {
		where = {
			"db": null,
			"rollback": function(err) {
				if(this.db && this.db.rollback) { this.db.rollback(); }
				throw err;
			}
		};
		return where;
	}
	function inner(db) {
		where.db = db;
		return db;
	}
	return inner;
};

module.exports = PostgreSQL;

/* EOF */
