/** Extended PostgreSQL bindings for pg module */
"use strict";

var debug = require('nor-debug');
var FUNCTION = require('nor-function');
var util = require('util');
var Q = require('q');
var PG = require('pg');
var EventEmitter = require('events');
var extend = require('nor-extend');
var ActionObjectNoEvents = require('nor-extend/src/ActionObjectNoEvents.js');
var is = require('nor-is');
var pg_escape = require('pg-escape');

/* Optional newrelic instrumentation support */
var nr_fcall = require('nor-newrelic/src/fcall.js');
var nr_nfbind = require('nor-newrelic/src/nfbind.js');

/* Bindings */
var bindings = {};

/* Pool size */
var NOR_PG_POOL_SIZE = process.env.NOR_PG_POOL_SIZE ? parseInt(process.env.NOR_PG_POOL_SIZE, 10) : 10;
PG.defaults.poolSize = NOR_PG_POOL_SIZE;

/** Handle `PG.connect()` callback results using defered object */
function catch_results(defer, err, client, done) {
	//debug.log('catch_results()...');
	if(err) {
		return defer.reject(err);
	}
	defer.resolve({"client":client, "done":done});
}

/** `pg.connect` bindings */
bindings.connect = function(config) {
	var defer = Q.defer();
	//debug.log('PG.connect()...');
	PG.connect(config, FUNCTION(catch_results).curry(defer) );
	return defer.promise;
};

/** PostgreSQL connection constructor */
function PostgreSQL(config) {
	this.config = config;
	this._events = new EventEmitter();
	ActionObjectNoEvents.call(this);
}
util.inherits(PostgreSQL, ActionObjectNoEvents);

/* Make wrappers for PostgreSQL listen/notify implementation */
['addListener', 'removeListener', 'on', 'once', 'emit'].forEach(function wrapper_builder(fn) {
	/** Wrapper for PostgreSQL events */
	PostgreSQL.prototype[fn] = function wrapper() {
		var self = this;
		var args = Array.prototype.slice.call(arguments);
		var name = args[0];
		if(name && (name.charAt(0) === '$')) {
			//debug.log('name =', name, ', args=', args);
			self._events[fn].apply(self, args);
			return self;
		}
		//debug.log('name =', name, ', args=', args);
		return self['_'+fn].apply(self, args);
	};
});

/** Implements `.addListener()` with PostgreSQL listen */
PostgreSQL.prototype._addListener = function PostgreSQL__addListener(name, listener) {
	var self = this;
	debug.assert(name).is('string');
	debug.assert(listener).is('function');
	//debug.log('name =', name, ', listener=', listener);
	self._events.addListener(name, listener);
	return self.listen(name);
};

/** Implements `.removeListener()` with PostgreSQL listen */
PostgreSQL.prototype._removeListener = function PostgreSQL__addListener(name, listener) {
	var self = this;
	debug.assert(name).is('string');
	debug.assert(listener).is('function');
	//debug.log('name =', name, ', listener=', listener);
	self._events.removeListener(name, listener);
	return self.unlisten(name);
};

/** Implements `.on()` with PostgreSQL listen */
PostgreSQL.prototype._on = function PostgreSQL__on(name, listener) {
	var self = this;
	debug.assert(name).is('string');
	debug.assert(listener).is('function');
	//debug.log('name =', name, ', listener=', listener);
	self._events.on(name, listener);
	return self.listen(name);
};

/** Implements `.once()` with PostgreSQL listen and unlisten */
PostgreSQL.prototype._once = function PostgreSQL__once(name, listener) {
	var self = this;
	debug.assert(name).is('string');
	debug.assert(listener).is('function');
	//debug.log('name =', name, ', listener=', listener);
	self._events.once(name, function() {
		var self2 = this;
		var args = Array.prototype.slice.call(arguments);
		self.unlisten(name).fail(function(err) {
			debug.error('Failed to unlisten: ', err);
		}).done();
		return listener.apply(self2, args);
	});
	return self.listen(name);
};

/** Implements `.emit()` with PostgreSQL notify */
PostgreSQL.prototype._emit = function PostgreSQL__emit() {
	var self = this;
	var args = Array.prototype.slice.call(arguments);
	var name = args.shift();
	debug.assert(name).is('string');
	//debug.log('name =', name);
	//debug.log('args =', args);
	var payload = JSON.stringify(args);
	//debug.log('payload =', payload);
	return self.notify(name, payload);
};

/* Event listener */
function notification_event_listener(self, msg) {

	//debug.log('msg = ', msg);

	self._events.emit('$notification', msg);

            //msg = {
            //  name: 'notification',
            //  length: 70,
            //  processId: 1707,
            //  channel: 'tcn',
            //  payload: '"documents",I,"id"=\'0c402f6f-8126-5dc3-a4df-20035bc8304d\''
            //}

	/* Parse notification and emit again correctly */
	var channel = msg && msg.channel || undefined;
	var payload = msg && msg.payload || undefined;
	//debug.log(
	//	'channel = ', channel, '\n',
	//	'payload = ', payload
	//);

	if( (payload.charAt(0) !== '[') ) {
		self._events.emit(channel, payload);
		return;
	}

	var parsed_payload;
	try {
		parsed_payload = JSON.parse(payload);
	} catch(e) {
		self._events.emit(channel, payload);
		return;
	}
	//debug.log('parsed_payload = ', parsed_payload);
	if(is.array(parsed_payload)) {
		self._events.emit.apply(self._events, [channel].concat(parsed_payload));
	} else {
		self._events.emit.apply(self._events, [channel].concat([parsed_payload]));
	}
}

/** Resolve a promise */
/*
function promise_resolve(defer, err, result) {
	if(err) {
		defer.reject(err);
		return;
	}

	defer.resolve(result);
}
*/

/** `res` will have properties client and done from pg.connect() */
function handle_res(self, res) {
	//debug.log('handle_res()...');

	debug.assert(self).is('object');
	debug.assert(res).is('object');
	debug.assert(res.client).is('object');

	var client = res.client;

	debug.assert(client.query).is('function');

	var conn = {
		"query": nr_nfbind("nor-pg:query", FUNCTION(client.query).bind(client)),
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
	//debug.log('.connect()...');
	var self = this;

	if(self._client || self._close_client) {
		throw new TypeError("Connected already?");
	}

	self._notification_listener = FUNCTION(notification_event_listener).curry(self);
	debug.assert(self._notification_listener).is('function');

	return extend.promise([PostgreSQL], nr_fcall('nor-pg:connect', function() {
		return bindings.connect(self.config).then(FUNCTION(handle_res).curry(self));
	}));
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
ActionObjectNoEvents.setup(PostgreSQL, 'query', function(str, params){
	var self = this;
	var conn = self._conn;
	if(conn === undefined) {
		throw new TypeError("Disconnected from PostgreSQL");
	}
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

/** Listen a channel */
PostgreSQL.prototype.listen = function(channel) {
	debug.assert(channel).is('string').pattern(/^[a-zA-Z][a-zA-Z0-9_]*$/);
	var self = this;
	return self._query(pg_escape('LISTEN %I', channel)).then(function() { return self; });
};

/** Stop listening a channel */
PostgreSQL.prototype.unlisten = function(channel) {
	debug.assert(channel).is('string').pattern(/^[a-zA-Z][a-zA-Z0-9_]*$/);
	var self = this;
	return self._query(pg_escape('UNLISTEN %I', channel)).then(function() { return self; });
};

/** Notify a channel */
PostgreSQL.prototype.notify = function(channel, payload) {
	debug.assert(channel).is('string').pattern(/^[a-zA-Z][a-zA-Z0-9_]*$/);
	var self = this;
	if(payload !== undefined) {
		return self._query(pg_escape('NOTIFY %I, %L', channel, payload)).then(function() { return self; });
	}
	return self._query(pg_escape('NOTIFY %I', channel)).then(function() { return self; });
};

/** Get new connection and start transaction */
PostgreSQL.start = function(config) {
	var pg = new PostgreSQL(config);
	return pg.connect().start();
};

/** Get new connection without starting a transaction */
PostgreSQL.connect = function(config) {
	var pg = new PostgreSQL(config);
	return pg.connect();
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
