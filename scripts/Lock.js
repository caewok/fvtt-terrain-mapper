/* globals
flattenObject,
game
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// https://jackpordi.com/posts/locks-in-js-because-why-not
export class Lock {
  /** @type {obj[]} */
  #queue = [];

  /** @type {boolean} */
  #acquired = false;

  async acquire() {
    if ( !this.#acquired ) this.#acquired = true;
    else {
      return new Promise((resolve, _) => {
        this.#queue.push(resolve);
      });
    }
  }

  async release() {
    if ( !this.#queue.length && this.#acquired ) {
      this.#acquired = false;
      return;
    }

    const continuation = this.#queue.shift();
    return new Promise(res => {
      continuation();
      res();
    });
  }
}

/* Example
let value = 0;
async function thread(lock: Lock) {
  // Execute some code, maybe asynchronously
  // .....
  await sleep(Math.random() * 1000);
  await lock.acquire();
  const readValue = value; // Read our value here
  // Execute more code
  // .....
  value = readValue + 1;
  await lock.release();
}

async function main() {
  const lock = new Lock();
  await Promise.all([
    thread(lock),
    thread(lock),
    thread(lock),
    thread(lock),
    thread(lock),
  ]);
  console.log(value);
}

main();

*/