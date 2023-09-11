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

  /**
   * @typedef {Object} TerrainConfig          Terrain configuration data
   * @property {string} name                  User-facing name of the terrain.
   * @property {number} id                    Id between 1 and TerrainMap.MAX_TERRAINS
   * @property {string} icon                  URL of icon representing the terrain
   * @property {hex} color                    Hex value for the color representing the terrain
   * @property {FLAGS.ANCHOR.CHOICES} anchor  Measure elevation as fixed, from terrain, or from layer.
   * @property {number} offset                Offset elevation from anchor
   * @property {number} rangeAbove            How far above the offset the terrain extends
   * @property {number} rangeBelow            How far below the offset the terrain extends
   * @property {boolean} userVisible          Is this terrain visible to the user?
   * @property {ActiveEffect} activeEffect    Active effect associated with this terrain
   */
  config = {};

  /** @type {boolean} */
  userVisible = false;

  /**
   * @param {TerrainConfig} config
   * @param {object} [opts]
   * @param {boolean} [opts.override=false]     Should this terrain replace an existing id?
   */
  constructor(config, { override = false } = {}) {
    config = this.config = foundry.utils.deepClone(config);

    // Register this terrain with the terrain map and determine the corresponding id.
    this.#id = this.constructor.TERRAINS.set(config.id, this, override);
    if ( !this.#id ) {
      console.error(`Issue setting id ${id} for terrain.`);
      return;
    }
    this.userVisible ||= config.userVisible;
    this.initializeConfiguration();
  }

  get id() { return this.#id; }

  /**
   * Initialize certain undefined configuration values.
   * Requires id to be set.
   */
  initializeConfiguration() {
    // Initialize certain configurations.
    this.config.name = config.name || "Unnamed Terrain";
    this.config.offset = config.offset ?? 0;
    this.config.rangeBelow = config.rangeBelow ?? 0;
    this.config.rangeAbove = config.rangeAbove ?? 0;
    this.config.anchor = config.anchor ?? FLAGS.ANCHOR.CHOICES.RELATIVE_TO_TERRAIN;

    // Use the id to select a default terrain color.
    this.config.color = config.color || this.constructor.COLORS[this.#id];
  }

  /**
   * Destroy this terrain and remove it from the terrain map.
   */
  destroy() {
    this.constructor.TERRAINS.delete(this.#id);
  }
}
