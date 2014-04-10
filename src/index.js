/** Extended PostgreSQL bindings for pg module */

var debug = require('nor-debug');
var util = require('util');
var Q = require('q');
var PG = require('pg');
var extend = require('nor-extend');
var is = require('nor-is');

/* Bindings */
var bindings = {};

/** `pg.connect` bindings */
bindings.connect = function(config) {
	var defer = Q.defer();
	PG.connect(config, function(err, client, done) {
		if(err) {
			return defer.reject(err);
		}
		defer.resolve({client:client, done:done});
	});
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
		throw TypeError("Connected already?");
	}

	self._notification_listener = notification_event_listener.bind(self);
	debug.assert(self._notification_listener).is('function');

	/** `res` will have properties client and done from pg.connect() */
	function handle_res(res) {
		self._conn = {};
		self._conn.client = res.client;
		self._conn.query = Q.nfbind(self._conn.client.query.bind(self._conn.client));
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
	self._conn.done();
	delete self._conn;
	return self;
};

/** Internal query transaction */
extend.ActionObject.setup(PostgreSQL, 'query', function(str, params){
	var self = this;
	function strip_res(result) {
		return result.rows;
	}
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
