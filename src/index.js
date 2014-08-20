/** Extended PostgreSQL bindings for pg module */
"use strict";

var debug = require('nor-debug');
var util = require('util');
var Q = require('q');
var PG = require('pg');
var extend = require('nor-extend');
var is = require('nor-is');

/** Returns true if module exists */
function module_exists(name) {
	try {
		require.resolve(name);
		return true;
	} catch(e) {
		return false;
	}
}

/* Newrelic instrumentation */
var nr;
if(module_exists("newrelic") && (!process.env.DISABLE_NEWRELIC)) {
	debug.info('Enabled newrelic instrumentation for nor-pg.');
	try {
		nr = require("newrelic");
	} catch(e) {
		debug.warn('Failed to setup NewRelic support: ' + e);
		nr = undefined;
	}
}

/* Bindings */
var bindings = {};

/** `pg.connect` bindings */
bindings.connect = function(config) {
	var defer = Q.defer();

	function catch_results(err, client, done) {
		if(err) {
			return defer.reject(err);
		}
		defer.resolve({client:client, done:done});
	}

	if(nr) {
		PG.connect(config, nr.createTracer('nor-pg:connect', catch_results));
	} else {
		PG.connect(config, catch_results);
	}
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

/** Create connection (or take it from the pool) */
PostgreSQL.prototype.connect = function() {
	var self = this;

	if(self._client || self._close_client) {
		throw new TypeError("Connected already?");
	}

	self._notification_listener = notification_event_listener.bind(self);
	debug.assert(self._notification_listener).is('function');

	/** `res` will have properties client and done from pg.connect() */
	function handle_res(res) {
		self._conn = {};
		self._conn.client = res.client;

		if(!nr) {
			self._conn.query = Q.nfbind(self._conn.client.query.bind(self._conn.client));
		} else {
			self._conn.query = function wrap_query() {
				var args = Array.prototype.slice.call(arguments);
				var defer = Q.defer();
				self._conn.client.query.apply(self._conn.client, args.concat([
					nr.createTracer('nor-pg:query', function promise_resolve(err, result) {
						if(err) {
							defer.reject(err);
						} else {
							defer.resolve(result);
						}
					})
				]));
				return defer.promise;
			};
		}

		self._conn.done = res.done;

		// Pass NOTIFY to clients
		if (is.func(self.emit)) {
			debug.assert(self._notification_listener).is('function');
			self._conn.client.on('notification', self._notification_listener);
		}

		return self;
	}

	return extend.promise([PostgreSQL], bindings.connect(this.config).then(handle_res));
};

/** Disconnect connection (or actually release it back to pool) */
PostgreSQL.prototype.disconnect = function() {
	var self = this;
	if(is.func(self._notification_listener)) {
		self._conn.client.removeListener('notification', self._notification_listener);
		delete self._notification_listener;
	}
	if(is.object(self) && is.defined(self._conn)) {
		self._conn.done();
		delete self._conn;
	} else {
		debug.warn('called on uninitialized connection -- maybe multiple times?');
	}
	return self;
};

/** Internal query transaction */
extend.ActionObject.setup(PostgreSQL, 'query', function(str, params){
	var self = this;
	function strip_res(result) {
		return result.rows;
	}
	debug.assert(self._conn).is('object');
	return self._conn.query(str, params).then(strip_res);
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
