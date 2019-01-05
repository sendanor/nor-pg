"use strict";

const TEST_TABLE = 'test_account';

const PGCONFIG = process.env.PGCONFIG || 'pg://postgres@localhost/test';
const TEST_TIMEOUT = process.env.TEST_TIMEOUT ? parseInt(process.env.TEST_TIMEOUT, 10) : undefined;
const ENABLE_COVERAGE = !!process.env.ENABLE_COVERAGE;

import _Q from 'q';
import debug from '@norjs/debug';
import is from '@norjs/is';
import assert from 'assert';

_Q.longStackSupport = true;

let pg = ENABLE_COVERAGE ? require('../../dist-cov/index.js') : require('../../dist/index.js');
if (pg.default) {
	pg = pg.default;
}

///** */
//function not_in (a) {
//	debug.assert(a).is('array');
//	return x => a.indexOf(x) === -1;
//}

///** Run init() at start */
//before(() => pg.start(PGCONFIG).init().then(db => {
//	//var doc = db.fetch();
//	//debug.log('initialized database: doc = ', doc);
//	return db.commit();
//}));

/* */
describe('nor-pg', function(){

	if (TEST_TIMEOUT >= 2000) {
		this.timeout(TEST_TIMEOUT);
	}

	describe('.connect', function() {

		it('is callable', () => {
			debug.assert(pg).is('function');
			debug.assert(pg.connect).is('function');
		});

	});

	describe('.start', function() {

		it('is callable', () => {
			debug.assert(pg).is('function');
			debug.assert(pg.start).is('function');
		});

		it('can query rows', () => {
			return pg.start(PGCONFIG).query(`SELECT * FROM "${TEST_TABLE}"`).then(db => {
				debug.assert(db).is('object');
				debug.assert(db.fetch).is('callable');
				const rows = db.fetch();
				debug.assert(rows).is('array');
				debug.assert(rows.length).equals(3);

				debug.assert(rows[0]).is('object');
				debug.assert(rows[0].username).equals("foo1");
				debug.assert(rows[0].password).equals("bar1");
				debug.assert(rows[0].created.getTime()).equals(1403211600000);

				debug.assert(rows[1]).is('object');
				debug.assert(rows[1].username).equals("foo2");
				debug.assert(rows[1].password).equals("bar2");
				debug.assert(rows[1].created.getTime()).equals(1543701600000);

				debug.assert(rows[2]).is('object');
				debug.assert(rows[2].username).equals("foo3");
				debug.assert(rows[2].password).equals("bar3");
				debug.assert(rows[2].created.getTime()).equals(1547071200000);

				return db;
			}).commit();
		});

	});

});

/* EOF */

