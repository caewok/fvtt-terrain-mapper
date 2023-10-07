/* globals

*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

/**
 * Subclass of Map that manages terrain ids and ensures only 1–31 are used.
 * @type {Map<number, Terrain>}
 */
export class TerrainMap extends Map {
  /** @type {number} */
  #nextId = 0;

  /** @type {Map<string, Terrain>} */
  terrainIds = new Map();

  /** @override */
  set(id, terrain, override = false) {
    id ??= this.#nextId;

    if ( !override && this.has(id) ) {
      console.error("Id already present and override is false.");
      return;
    }

    if ( !Number.isInteger(id) || id < 0 ) {
      console.error(`Id ${id} is invalid.`);
      return;
    }

    super.set(id, terrain);
    this.terrainIds.set(terrain.id, terrain);
    this.#nextId = this.#findNextId();
    return id;
  }

  /**
   * Add using the next consecutive id.
   */
  add(terrain) {
    const id = this.#nextId;
    super.set(id, terrain);
    this.terrainIds.set(terrain.id, terrain);
    this.#nextId = this.#findNextId();
    return id;
  }

  /**
   * Locate the next id in consecutive order.
   */
  #findNextId() {
    // Next id is always the smallest available.
    // If size 0: next id must be 0.
    // If size is 1, then 0 must be assigned; next id is 1.
    if ( this.size === this.#nextId ) return this.#nextId;

    const keys = [...this.keys()].sort((a, b) => a - b);
    keys.unshift(-1); // So arrays like [3, 4, 5] work.
    const lastConsecutiveKey = keys.find((k, idx) => keys[idx + 1] !== k + 1);
    return lastConsecutiveKey + 1 ?? 0;
  }

  /** @override */
  clear() {
    super.clear();
    this.terrainIds.clear();
    this.#nextId = 1;
  }

  /** @override */
  delete(id) {
    const terrain = this.get(id);
    if ( terrain ) this.terrainIds.delete(terrain.id);
    if ( !super.delete(id) ) return false;
    if ( this.#nextId > id ) this.#nextId = this.#findNextId();
    return true;
  }

  /**
   * Does this map have a specific terrain id?
   */
  hasTerrainId(id) { return this.terrainIds.has(id); }

  /**
   * Key for a given value.
   * @param {*} value     The value to match.
   * @returns {*|undefined} The key associated with the value, or false if none.
   */
  keyForValue(value) {
    for ( const [key, testValue] of this.entries() ) {
      if ( value === testValue ) return key;
    }
    return undefined;
  }
}
