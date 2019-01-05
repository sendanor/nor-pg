/* Extended PostgreSQL bindings for pg module
 * Copyright 2014-2019 Jaakko-Heikki Heusala <jheusala@iki.fi>
 */

"use strict";

import debug from '@norjs/debug';
import is from '@norjs/is';
import { Pool } from 'pg';
import {Async, promiseCall} from './Async.js';
import EventEmitter from 'events';
import extend from 'nor-extend';
import ActionObjectNoEvents from 'nor-extend/ActionObjectNoEvents.js';
import pg_escape from 'pg-escape';

let privateQuery;

function nr_fcall (desc, fn) {
	return promiseCall(fn);
}

function nr_nfbind (desc, fn) {
	return (...args) => promiseCall(() => fn(...args));
}

/** Event listener
 *
 * @param self
 * @param msg
 */
function notification_event_listener (self, msg) {

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
	let channel = msg && msg.channel || undefined;
	let payload = msg && msg.payload || undefined;
	//debug.log(
	//	'channel = ', channel, '\n',
	//	'payload = ', payload
	//);

	if ( (payload.charAt(0) !== '[') ) {
		self._events.emit(channel, payload);
		return;
	}

	let parsed_payload;
	try {
		parsed_payload = JSON.parse(payload);
	} catch(e) {
		self._events.emit(channel, payload);
		return;
	}
	//debug.log('parsed_payload = ', parsed_payload);
	if (is.array(parsed_payload)) {
		self._events.emit.apply(self._events, [channel].concat(parsed_payload));
	} else {
		self._events.emit.apply(self._events, [channel].concat([parsed_payload]));
	}
}

/* Bindings */
let bindings = {};

/* Pool size */
const NOR_PG_POOL_SIZE = process.env.NOR_PG_POOL_SIZE ? parseInt(process.env.NOR_PG_POOL_SIZE, 10) : 10;

/** Handle `PG.connect()` callback results using Promise
 *
 * @param resolve
 * @param reject
 * @param err
 * @param client
 * @param done
 * @returns {*}
 */
function catchResults (resolve, reject, err, client, done) {
	//debug.log('catchResults()...');
	if (err) {
		return reject(err);
	}
	resolve({"client":client, "done":done});
}

/** `pg.connect` bindings
 *
 * @param config
 * @returns {Promise}
 */
bindings.connect = pool => Async.Promise(( resolve, reject ) => {
	pool.connect(( ...args ) => catchResults(resolve, reject, ...args));
});

/** `res` will have properties client and done from pg.connect()
 *
 * @param self
 * @param res
 * @returns {*}
 */
function handle_res (self, res) {
	//debug.log('handle_res()...');

	debug.assert(self).is('object');
	debug.assert(res).is('object');
	debug.assert(res.client).is('object');

	let client = res.client;

	debug.assert(client.query).is('function');

	let conn = {
		"query": nr_nfbind("nor-pg:query", client.query.bind(client)),
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

/**
 *
 */
class PostgreSQL extends ActionObjectNoEvents {

	/** PostgreSQL connection constructor
	 *
	 * @param config
	 */
	constructor (config) {
		super();
		this.config = config;
		this._events = new EventEmitter();
	}

	/** Implements `.addListener()` with PostgreSQL listen
	 *
	 * @param name
	 * @param listener
	 * @returns {*}
	 * @private
	 */
	_addListener (name, listener) {
		let self = this;
		debug.assert(name).is('string');
		debug.assert(listener).is('function');
		//debug.log('name =', name, ', listener=', listener);
		self._events.addListener(name, listener);
		return self.listen(name);
	}

	/** Implements `.removeListener()` with PostgreSQL listen
	 *
	 * @param name
	 * @param listener
	 * @returns {*}
	 * @private
	 */
	_removeListener (name, listener) {
		let self = this;
		debug.assert(name).is('string');
		debug.assert(listener).is('function');
		//debug.log('name =', name, ', listener=', listener);
		self._events.removeListener(name, listener);
		return self.unlisten(name);
	}

	/** Implements `.on()` with PostgreSQL listen */
	_on (name, listener) {
		let self = this;
		debug.assert(name).is('string');
		debug.assert(listener).is('function');
		//debug.log('name =', name, ', listener=', listener);
		self._events.on(name, listener);
		return self.listen(name);
	}

	/** Implements `.once()` with PostgreSQL listen and unlisten
	 *
	 * @param name
	 * @param listener
	 * @returns {*}
	 * @private
	 */
	_once (name, listener) {
		let self = this;
		debug.assert(name).is('string');
		debug.assert(listener).is('function');
		//debug.log('name =', name, ', listener=', listener);
		self._events.once(name, function(...args) {
			let self2 = this;
			self.unlisten(name).fail(err => {
				debug.error('Failed to unlisten: ', err);
			}).done();
			return listener.apply(self2, args);
		});
		return self.listen(name);
	}

	/** Implements `.emit()` with PostgreSQL notify
	 *
	 * @param args
	 * @returns {*}
	 * @private
	 */
	_emit (...args) {
		let self = this;
		let name = args.shift();
		debug.assert(name).is('string');
		//debug.log('name =', name);
		//debug.log('args =', args);
		let payload = JSON.stringify(args);
		//debug.log('payload =', payload);
		return self.notify(name, payload);
	}

	/** Create connection (or take it from the pool)
	 *
	 * @returns {*|*}
	 */
	connect () {
		//debug.log('.connect()...');
		let self = this;

		if (self._client || self._close_client) {
			throw new TypeError("Connected already?");
		}

		self._notification_listener = (...args) => notification_event_listener(self, ...args);
		debug.assert(self._notification_listener).is('function');

		if (!self.pool) {
			self.pool = new Pool({
				max: NOR_PG_POOL_SIZE,
				connectionString: self.config
			});
		}

		return extend.promise([PostgreSQL], nr_fcall(
			'nor-pg:connect',
			() => bindings.connect(self.pool).then((...args) => handle_res(self, ...args))
		));
	}

	/** Disconnect connection (or actually release it back to pool)
	 *
	 * @returns {PostgreSQL}
	 */
	disconnect () {
		let conn = this._conn;
		let client = conn.client;
		let listener = this._notification_listener;

		if (is.func(listener)) {
			client.removeListener('notification', listener);
			delete this._notification_listener;
		}

		if (is.defined(conn)) {
			conn.done();
			delete this._conn;
		} else {
			debug.warn('called on uninitialized connection -- maybe multiple times?');
		}

		return this;
	}

	/** Start transaction
	 *
	 * @returns {PromiseLike<PostgreSQL | never> | Promise<PostgreSQL | never>}
	 */
	start () {
		return this[privateQuery]('BEGIN').then(() => this);
	}

	/** Commit transaction
	 *
	 * @returns {PromiseLike<PostgreSQL | never> | Promise<PostgreSQL | never>}
	 */
	commit () {
		return this[privateQuery]('COMMIT').then(() => this.disconnect());
	}

	/** Rollback transaction
	 *
	 * @returns {PromiseLike<PostgreSQL | never> | Promise<PostgreSQL | never>}
	 */
	rollback () {
		return this[privateQuery]('ROLLBACK').then(() => this.disconnect());
	}

	/** Listen a channel
	 *
	 * @param channel
	 * @returns {PromiseLike<PostgreSQL | never> | Promise<PostgreSQL | never>}
	 */
	listen (channel) {
		debug.assert(channel).is('string').pattern(/^[a-zA-Z][a-zA-Z0-9_]*$/);
		return this[privateQuery](pg_escape('LISTEN %I', channel)).then(() => this);
	}

	/** Stop listening a channel
	 *
	 * @param channel
	 * @returns {PromiseLike<PostgreSQL | never> | Promise<PostgreSQL | never>}
	 */
	unlisten (channel) {
		debug.assert(channel).is('string').pattern(/^[a-zA-Z][a-zA-Z0-9_]*$/);
		return this[privateQuery](pg_escape('UNLISTEN %I', channel)).then(() => this);
	}

	/** Notify a channel
	 *
	 * @param channel
	 * @param payload
	 * @returns {PromiseLike<PostgreSQL | never> | Promise<PostgreSQL | never>}
	 */
	notify (channel, payload) {
		debug.assert(channel).is('string').pattern(/^[a-zA-Z][a-zA-Z0-9_]*$/);
		if (payload !== undefined) {
			return this[privateQuery](pg_escape('NOTIFY %I, %L', channel, payload)).then(() => this);
		}
		return this[privateQuery](pg_escape('NOTIFY %I', channel)).then(() => this);
	}

	/** Get new connection and start transaction
	 *
	 * @param config
	 * @returns {*}
	 */
	static start (config) {
		let pg = new PostgreSQL(config);
		return pg.connect().start();
	}

	/** Get new connection without starting a transaction
	 *
	 * @param config
	 * @returns {*}
	 */
	static connect (config) {
		let pg = new PostgreSQL(config);
		return pg.connect();
	}

	/** This is a helper function for implementing rollback handler for promise fails.
	 * Usage:
	 *    let scope = pg.scope();
	 *    pg.start(opts.pg).then(pg.scope(scope)).query(...).commit().fail(scope.rollback)
	 * @param where
	 * @return {*}
	 */
	static scope (where) {

		if (where === undefined) {
			where = {
				"db": null,
				"rollback": function (err) {
					if (this.db && this.db.rollback) {
						this.db.rollback();
					}
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
	}

}

/* Make wrappers for PostgreSQL listen/notify implementation */
['addListener', 'removeListener', 'on', 'once', 'emit'].forEach(fn => {
	/** Wrapper for PostgreSQL events */
	PostgreSQL.prototype[fn] = function wrapper(...args) {
		let name = args[0];
		if (name && (name.charAt(0) === '$')) {
			//debug.log('name =', name, ', args=', args);
			this._events[fn].apply(this, args);
			return this;
		}
		//debug.log('name =', name, ', args=', args);
		return this['_'+fn].apply(this, args);
	};
});

/** Returns value of property `rows` from `result`
 *
 * @param result
 * @returns {*}
 */
function strip_res (result) {
	return result.rows;
}

/* Internal query transaction */
privateQuery = ActionObjectNoEvents.setup(PostgreSQL, 'query', function(str, params) {
	let conn = this._conn;
	if (conn === undefined) {
		throw new TypeError("Disconnected from PostgreSQL");
	}
	debug.assert(conn).is('object');
	return conn.query(str, params).then(strip_res);
});

export default PostgreSQL;

/* EOF */
