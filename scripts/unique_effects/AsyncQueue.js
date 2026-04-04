/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

/**
 * Basic queue class
 */
class Queue {

  /** @type {*} */
  #queue = [];

  enqueue(item) { this.#queue.push(item); }

  dequeue() { return this.#queue.shift(); }

  get size() { return this.#queue.length; }
}

export class AsyncQueue extends Queue {
  /** @type {boolean} */
  #isRunning = false;

  /**
   * Add a function to the task. The function should be async.
   * If a promise is passed, the promise will be awaited.
   * @param {function|Promise} task
   */
  enqueue(task) {
    super.enqueue(task);
    if ( !this.#isRunning ) this.processNext();
  }

  async processNext() {
    if ( !this.size ) {
      this.#isRunning = false;
      return;
    }
    this.#isRunning = true;
    const task = this.dequeue();
    try {
      if ( task instanceof Promise ) await task;
      else await task();
    } catch ( err ) {
      console.error("AsyncQueue|task failed:", err);
    } finally {
      this.processNext();
    }
  }
}

/* Example usage
queue = new AsyncQueue();

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

task1 = async () => {
  console.log("Task 1 started.");
  await sleep(1000);
  console.log("Task 1 completed");
}

a = "hello";
task2 = async () => {
  console.log(`Task 2 started. ${a}`);
  await sleep(500);
  console.log("Task 2 completed");
}

a = "goodbye" // Will make task 2 change to goodbye.
task3 = async () => {
  console.log(`Task 3 started. ${a}`);
  await sleep(500);
  console.log("Task 3 completed");
}

queue.enqueue(task1)
queue.enqueue(task2)
queue.enqueue(task3)

*/


