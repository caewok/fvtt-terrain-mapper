/* globals

*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { FLAGS, COLORS } from "./const.js";

/**
 * Subclass of Map that manages terrain ids and ensures only 1–31 are used.
 */
class TerrainMap extends Map {
  /** @type {number} */
  MAX_TERRAINS = Math.pow(2, 5) - 1; // No 0 id.

  /** @type {number} */
  #nextId = 1;

  /** @override */
  set(id, terrain, override = false) {
    id ??= this.#nextId;

    if ( !override && this.has(id) ) {
      console.error("Id already present and override is false.");
      return;
    }

    if ( !Number.isInteger(id) || id < 1 ) {
      console.error(`Id ${id} is invalid.`);
      return;
    }

    if ( id > this.MAX_TERRAINS ) { console.warn(`Id ${id} exceeds maximum terrains (${this.MAX_TERRAINS}).`); }

    super.set(id, terrain);
    this.#nextId = this.#findNextId();
    return id;
  }

  /**
   * Add using the next consecutive id.
   */
  add(terrain) {
    const id = this.#nextId;
    if ( id > this.MAX_TERRAINS ) { console.warn(`Id ${id} exceeds maximum terrains (${this.MAX_TERRAINS}).`); }
    super.set(id, terrain);
    this.#nextId = this.#findNextId();
    return id;
  }

  /**
   * Locate the next id in consecutive order.
   */
  #findNextId() {
    // Next id is always the smallest available. So if it equals the size, we can just increment by 1.
    if ( this.size === (this.#nextId - 1) ) return this.#nextId + 1;

    const keys = [...this.keys()].sort((a, b) => a - b);
    const lastConsecutiveKey = keys.find((k, idx) => keys[idx + 1] !== k + 1);
    return lastConsecutiveKey + 1 ?? 1;
  }

  /** @override */
  clear() {
    super.clear();
    this.#nextId = 1;
  }

  /** @override */
  delete(id) {
    if ( !super.delete(id) ) return false;
    if ( this.#nextId > id ) this.#nextId = this.#findNextId();
    return true;
  }
}

/**
 * Class used to hold terrain data. Store the terrains by id. Ensures only 1 terrain per id.
 * Id is the pixel value for this terrain, before considering layers.
 */
export class Terrain {
  /** @type {TerrainMap{number; Terrain}} */
  static TERRAINS = new TerrainMap();

  // Default colors for terrains.
  static COLORS = COLORS;

  /** @type {number} */
  #id;

  constructor({
    name,
    id,
    icon,
    color,
    userVisible,
    anchor,
    offset,
    rangeBelow,
    rangeAbove,
    activeEffect,
    override = false } = {}) {

    this.name = name || "Unnamed Terrain";
    this.icon = icon;
    this.userVisible = userVisible ?? false;
    this.anchor = anchor ?? FLAGS.ANCHOR.CHOICES.RELATIVE_TO_TERRAIN;
    this.offset = offset ?? 0;
    this.rangeBelow = rangeBelow ?? 0;
    this.rangeAbove = rangeAbove ?? 0;
    this.activeEffect = activeEffect;
    this.#id = this.constructor.TERRAINS.set(id, this, override);
    if ( !this.#id ) {
      console.error(`Issue setting id ${id} for terrain.`);
      return;
    }
    this.color = color || this.constructor.COLORS[this.id];
  }

  get id() { return this.#id; }

  /**
   * Destroy this terrain and remove it from the terrain map.
   */
  destroy() {
    this.constructor.TERRAINS.delete(this.#id);
  }


}
