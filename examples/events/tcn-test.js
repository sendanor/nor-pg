/* TCN event test */
"use strict";
var debug = require('nor-debug');
var _Q = require('q');
var PGCONFIG = process.env.PGCONFIG;
var pg = require('../../src/index.js');

_Q.fcall(function() {
	return pg.connect(PGCONFIG).then(function(db) {
		return db.on('tcn', function tcn(payload) {
			//	payload = '"documents",I,"id"=\'0c402f6f-8126-5dc3-a4df-20035bc8304d\''
			debug.log('payload =', payload);
		}).then(function(db) {
			return db.on('tcn_insert_Test3', function tcn_insert_Test3(payload) {
				//	payload = '"documents",I,"id"=\'0c402f6f-8126-5dc3-a4df-20035bc8304d\''
				debug.log('payload =', payload);
			});
		});
	});
}).fail(function(err) {
	debug.error(err);
}).done();
