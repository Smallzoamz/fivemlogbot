import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';

async function test() {
  const db = await open({
    filename: './database.db',
    driver: sqlite3.Database
  });

  const logs = await db.all('SELECT * FROM logs ORDER BY id DESC LIMIT 20');
  console.log(JSON.stringify(logs, null, 2));
  await db.close();
}

test();
