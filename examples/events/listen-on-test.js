/* TCN event test */
"use strict";
var debug = require('nor-debug');
var _Q = require('q');
var PGCONFIG = process.env.PGCONFIG;
var pg = require('../../src/index.js');

_Q.fcall(function() {
	return pg.connect(PGCONFIG).then(function(db) {
		db.on('test', function(a, b, c) {
			debug.log(
				'test payload: \n',
				' a = ', a, '\n',
				' b = ', b, '\n',
				' c = ', c
			);
		});
	});
}).fail(function(err) {
	debug.error(err);
}).done();
