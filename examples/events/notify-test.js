/* TCN event test */
"use strict";
var debug = require('nor-debug');
var _Q = require('q');
var PGCONFIG = process.env.PGCONFIG;
var pg = require('../../src/index.js');

_Q.fcall(function() {
	return pg.connect(PGCONFIG).then(function(db) {
		return db.emit('test', {"foo":"bar"}, ["hello", "world"], 1234).then(function() {
			return db.disconnect();
		});
	});
}).then(function() {
	process.exit(0);
}).fail(function(err) {
	debug.error(err);
	process.exit(1);
}).done();
