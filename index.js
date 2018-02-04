'use strict';

const fs = require('fs');

const _ = require('lodash');
const sharp = require('sharp');
const Database = require('better-sqlite3');
const Tesseract = require('tesseract.js');

function migrate() {
  console.log('Updating migrations ...');

  const MIGRATIONS = {
    '001': 'CREATE TABLE players(id INTEGER PRIMARY KEY, name VARCHAR(40));',
    '002': 'CREATE TABLE aliases(id INTEGER PRIMARY KEY, player_id INTEGER NOT NULL, name VARCHAR(40) NOT NULL, FOREIGN KEY(player_id) references players(id) ON DELETE CASCADE);',
    '003': 'CREATE TABLE captures(id INTEGER PRIMARY KEY, player_id INTEGER NOT NULL, FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE CASCADE);'
  };

  const db = new Database('tracker.db');

  // check for migrations table
  if (!db.prepare("SELECT * FROM sqlite_master WHERE type = 'table' AND name = 'migrations';").get()) {
    console.log('-- creating migrations table.');
    db.prepare('CREATE TABLE migrations (id INTEGER PRIMARY KEY);').run();
  }

  // migrate
  const max_id = db.prepare('SELECT MAX(id) AS max_id FROM migrations').get().max_id + 0;

  _.each(MIGRATIONS, (query, id) => {
    if (Number(id) > max_id) {
      console.log(`-- running migration ${id}`);
      db.prepare(query).run();
      db.prepare(`INSERT INTO migrations(id) VALUES (${id});`).run();
    }
  });

  console.log('Migrations up to date.');

  return db;
}

const db = migrate();

if (!fs.existsSync('data'))
  fs.mkdirSync('data');

if (!fs.existsSync('data/orig'))
  fs.mkdirSync('data/orig');

if (!fs.existsSync('data/big'))
  fs.mkdirSync('data/big');

if (fs.existsSync('.tracker')) {
  const filenames = fs.readdirSync('.tracker');

  console.log('Copying and processing captures ...');

  Promise.all(_.map(filenames, filename => {
      if (!fs.existsSync(`data/bin/${filename}`))
        return sharp(`.tracker/${filename}`).resize(320).toFile(`data/big/${filename}`);
      else
        return Promise.resolve();
    })
  ).catch(err => console.log(err)).then(() => {
    console.log('Captures processed.')
  });
}

const filenames = fs.readdirSync('data/big');

console.log(`Collating ${filenames.length} captures ...`);

let lastJob = null;
let index = 1;

_.each(filenames, filename => {
  const timestamp = filename.replace('.png', '');

  if (!db.prepare(`select id as rowcount from captures where id=${timestamp};`).get()) {
    lastJob = Tesseract.recognize(`data/big/${filename}`)
      .then(result => {
        const alias = _.split(result.text, "\n")[1];
        console.log(`${index++}. Heart from ${alias}`);

        let player_id = null;
        const row = db.prepare(`select player_id from aliases where name = ?;`).get(alias);

        if (row) {
          player_id = row.player_id;
        }

        if (!player_id) {
          player_id = db.prepare(`insert into players(name) values (?)`).run(alias).lastInsertROWID;
          db.prepare(`insert into aliases(player_id, name) values (?, ?);`).run(player_id, alias);
        }

        db.prepare(`insert into captures(id, player_id) values ('${timestamp}', ${player_id});`).run();
      })
      .catch(err => {
        console.log(err);
      })
    ;
  }
});

lastJob.finally(() => {
  Tesseract.terminate();
});

// select p.id, p.name, count(c.id), max(c.id) as tally from captures c inner join players p on p.id = c.player_id group by p.name order by p.name asc;

