nor-pg
======

Promise-based PostgreSQL library for Node.js

Usage example
-------------

```javascript
var PostgreSQL = require('nor-pg');
PostgreSQL.start('postgres://username:password@localhost/dbname').query('SELECT * FROM foo').then(function(db) {
	var rows = db.fetch();
	console.log(util.inspect(rows));
	return db;
}).commit();
```

Installing
----------

You can install the module from NPM: `npm install nor-pg`

...and use it in your code:

```javascript
var PostgreSQL = require('nor-pg');
```

Reference
---------

The full API reference.

******************************************************************************

### Extended promises

We use [the Q library](https://github.com/kriskowal/q) with 
[nor-extend](https://github.com/Sendanor/nor-extend) to provide chainable 
extended promises.

These promises are essentially the same as Q promises with the exception that you 
can also use methods from this library just like when chaining methods in 
synchronic code. Just remember to pass on the instance of PostgreSQL in your 
own promise functions (as you would need to do when chaining in synchronic 
code).

******************************************************************************

### PostgreSQL.start()

Creates [new PostgreSQL instance](https://github.com/sendanor/nor-pg#new-postgresqlconfig),
[connects it](https://github.com/sendanor/nor-pg#postgresqlprototypeconnect) and 
[start transaction in it](https://github.com/sendanor/nor-pg#postgresqlprototypestart).

Returns an extended promise of PostgreSQL instance after these operations.

```javascript
PostgreSQL.start('postgres://username:password@localhost/dbname').query('INSERT INTO foo (a, b) VALUES ($1, $2)', [1, 2]).commit().then(function() {
	util.debug("All OK.");
}).fail(function(err) {
	util.error("Query failed: " + err);
}).done();
```


******************************************************************************

### new PostgreSQL(config)

The constructor function. You don't need to use this if you use 
[`.start()`](https://github.com/sendanor/nor-pg#postgresqlstart).

Returns new instance of PostgreSQL.

```javascript
var pg = new PostgreSQL('postgres://username:password@localhost/dbname');
pg.connect().start().query('INSERT INTO foo (a, b) VALUES ($1, $2)', [1, 2]).commit().then(function() {
	util.debug("All OK.");
}).fail(function(err) {
	util.error("Query failed: " + err);
}).done();
```


******************************************************************************

### PostgreSQL.prototype.connect()

Create connection (or take it from the pool).

You don't need to use this if you use 
[`.start()`](https://github.com/sendanor/nor-pg#postgresqlstart).

Returns an extended promise of connected PostgreSQL instance.

```javascript
var pg = new PostgreSQL('postgres://username:password@localhost/dbname');
pg.connect().query('INSERT INTO foo (a, b) VALUES ($1, $2)', [1, 2]).disconnect().then(function() {
	util.debug("All OK.");
}).fail(function(err) {
	util.error("Query failed: " + err);
}).done();
```


******************************************************************************

### PostgreSQL.prototype.disconnect()

Disconnect connection (or actually release it back to pool).

You don't need to call this if you use 
[`.commit()`](https://github.com/sendanor/nor-pg#postgresqlprototypecommit) or 
[`.rollback()`](https://github.com/sendanor/nor-pg#postgresqlprototyperollback), 
which will call `disconnect()`, too.

Returns an extended promise of disconnected PostgreSQL instance.

```javascript
var pg = new PostgreSQL('postgres://username:password@localhost/dbname');
pg.connect().query('INSERT INTO foo (a, b) VALUES ($1, $2)', [1, 2]).disconnect().then(function() {
	util.debug("All OK.");
}).fail(function(err) {
	util.error("Query failed: " + err);
}).done();
```


******************************************************************************

### PostgreSQL.prototype._query(str[, params])

Lower level implementation of the query function.

Returns a promise of the result of the query directly. No results are saved to 
the result queue.

```javascript
var pg = new PostgreSQL('postgres://username:password@localhost/dbname');
pg.connect()._query('SELECT FROM foo WHERE a = $1', [1]).then(function(rows) {
	util.debug("Rows = " + util.inspect(rows) );
	return pg.disconnect();
}).fail(function(err) {
	util.error("Query failed: " + err);
}).done();
```


******************************************************************************

### PostgreSQL.prototype.query(str[, params])

The default query implementation.

The result of the query can be fetched from the result queue of PostgreSQL 
object using [`.fetch()`](https://github.com/sendanor/nor-pg#postgresqlprototypefetch).

Returns an extended promise of the instance of PostgreSQL object.

```javascript
PostgreSQL.start('postgres://username:password@localhost/dbname').query('SELECT FROM foo WHERE a = $1', [1]).then(function(pg) {
	var rows = pg.fetch();
	util.debug("Rows = " + util.inspect(rows) );
	return pg.commit();
}).fail(function(err) {
	util.error("Query failed: " + err);
}).done();
```


******************************************************************************

### PostgreSQL.prototype.start()

Start transaction.

It will create new instance of PostgreSQL, then call 
[`.connect()`](https://github.com/sendanor/nor-pg#postgresqlprototypeconnect) 
and 
[`.start()`](https://github.com/sendanor/nor-pg#postgresqlprototypestart).

Returns an extended promise of the instance of PostgreSQL object after these operations.

```javascript
PostgreSQL.start('postgres://username:password@localhost/dbname').query('SELECT FROM foo WHERE a = $1', [1]).then(function(pg) {
	var rows = pg.fetch();
	util.debug("Rows = " + util.inspect(rows) );
	return pg.commit();
}).fail(function(err) {
	util.error("Query failed: " + err);
}).done();
```


******************************************************************************

### PostgreSQL.prototype.commit()

Commits transaction. This will also call 
[`.disconnect()`](https://github.com/sendanor/nor-pg#postgresqlprototypedisconnect).

Returns an extended promise of the instance of PostgreSQL object after these operations.

```javascript
PostgreSQL.start('postgres://username:password@localhost/dbname').query('SELECT FROM foo WHERE a = $1', [1]).then(function(pg) {
	var rows = pg.fetch();
	util.debug("Rows = " + util.inspect(rows) );
	return pg.commit();
}).fail(function(err) {
	util.error("Query failed: " + err);
}).done();
```


******************************************************************************

### PostgreSQL.prototype.rollback()

Rollback transaction. This will also call 
[`.disconnect()`](https://github.com/sendanor/nor-pg#postgresqlprototypedisconnect).

Returns an extended promise of the instance of PostgreSQL object after these operations.

```javascript
PostgreSQL.start('postgres://username:password@localhost/dbname').query('...').query('SELECT * FROM foo WHERE a = $1', [1]).then(function(pg) {
	var rows = pg.fetch();
	util.debug("Rows = " + util.inspect(rows) );
	if(rows.length >= 3) {
		return pg.rollback();
	}
	return pg.commit();
}).fail(function(err) {
	util.error("Query failed: " + err);
}).done();
```


******************************************************************************

### PostgreSQL.prototype.fetch()

Fetch next result from the result queue.

Returns the next value in the result queue of `undefined` if no more results.

This is implemented at [ActionObject of nor-extend](https://github.com/Sendanor/nor-extend/blob/master/lib/ActionObject.js#L32).

```javascript
PostgreSQL.start('postgres://username:password@localhost/dbname').query('SELECT * FROM foo').then(function(pg) {
	var rows = pg.fetch();
	util.debug("Rows = " + util.inspect(rows) );
	return pg.commit();
}).fail(function(err) {
	util.error("Query failed: " + err);
}).done();
```

******************************************************************************

### PostgreSQL.scope([where])

This is a helper function for implementing rollback handler for failed operations.

```javascript
var scope = pg.scope();
pg.start(opts.pg).then(pg.scope(scope)).query('...').then(...).commit().fail(scope.rollback)
```

******************************************************************************
