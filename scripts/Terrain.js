/* globals
Dialog,
foundry,
game,
readTextFromFile,
renderTemplate,
saveDataToFile,
ui
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { FLAGS, COLORS, MODULE_ID } from "./const.js";

/**
 * Subclass of Map that manages terrain ids and ensures only 1–31 are used.
 */
export class TerrainMap extends Map {
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
  /** @type {TerrainMap<number, Terrain>} */
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

  /** @type {TerrainMap<number, Terrain>} */
  terrainMap;

  /**
   * @param {TerrainConfig} config
   * @param {object} [opts]
   * @param {boolean} [opts.override=false]     Should this terrain replace an existing id?
   */
  constructor(config = {}, { override = false, terrainMap } = {}) {
    config = this.config = foundry.utils.deepClone(config);

    // Register this terrain with the terrain map and determine the corresponding id.
    this.terrainMap = terrainMap || this.constructor.TERRAINS;
    this.#id = this.terrainMap.set(config.id, this, override);
    if ( !this.#id ) {
      console.error(`Issue setting id ${config.id} for terrain.`);
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
    this.config.name ||= "Unnamed Terrain";
    this.config.offset ||= 0;
    this.config.rangeBelow ||= 0;
    this.config.rangeAbove ||= 0;
    this.config.anchor ??= FLAGS.ANCHOR.CHOICES.RELATIVE_TO_TERRAIN;
    this.config.userVisible ||= false;

    // Use the id to select a default terrain color.
    this.config.color ||= this.constructor.COLORS[this.#id];
  }

  /**
   * Destroy this terrain and remove it from the terrain map.
   */
  destroy() {
    this.terrainMap.delete(this.#id);
  }

  toJSON() {
    const out = this.config;
    out.activeEffect = out.activeEffect ? out.activeEffect.toJSON() : undefined;
    return out;
  }

  static toJSON() {
    const json = [];
    return this.TERRAINS.forEach(t => json.push(t.toJSON()))  ;
  }

  static saveToFile() {
    const data = this.toJSON() ?? {};
    data.flags ??= {};
    data.flags.exportSource = {
      world: game.world.id,
      system: game.system.id,
      coreVersion: game.version,
      systemVersion: game.system.version,
      terrainMapperVersion: game.modules.get(MODULE_ID).version
    };

    const filename = `${MODULE_ID}_terrains`;
    saveDataToFile(JSON.stringify(data, null, 2), "text/json", `${filename.json}`);
  }

  static importFromJSON(json) {
    console.debug("Need to process this json file!", json);
  }

  static async importFromFileDialog() {
    new Dialog({
      title: "Import Terrain Setting Data",
      content: await renderTemplate("templates/apps/import-data.html", {
        hint1: "You may import terrain settings data from an exported JSON file.",
        hint2: "This operation will update the terrain settings data and cannot be undone."
      }),
      buttons: {
        import: {
          icon: '<i class="fas fa-file-import"></i>',
          label: "Import",
          callback: html => {
            const form = html.find("form")[0];
            if ( !form.data.files.length ) return ui.notifications.error("You did not upload a data file!");
            readTextFromFile(form.data.files[0]).then(json => this.importFromJSON(json));
          }
        },
        no: {
          icon: '<i class="fas fa-times"></i>',
          label: "Cancel"
        }
      },
      default: "import"
    }, {
      width: 400
    }).render(true);
  }


}
