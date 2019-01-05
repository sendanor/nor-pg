
CREATE TABLE test_account (
 username VARCHAR (50) UNIQUE NOT NULL,
 password VARCHAR (50) NOT NULL,
 created TIMESTAMP NOT NULL
);

INSERT INTO test_account
 VALUES ('foo1', 'bar1', '2014-06-20')
, ('foo2', 'bar2', '2018-12-02')
, ('foo3', 'bar3', '2019-01-10');
