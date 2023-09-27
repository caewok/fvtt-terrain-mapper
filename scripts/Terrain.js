/* globals
ActiveEffect,
canvas,
CONFIG,
Dialog,
game,
getProperty,
readTextFromFile,
renderTemplate,
saveDataToFile,
ui
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { FLAGS, MODULE_ID, SOCKETS } from "./const.js";
import { Settings } from "./Settings.js";
import { EffectHelper } from "./EffectHelper.js";
import { TerrainEffectsApp } from "./TerrainEffectsApp.js";
import { Lock } from "./Lock.js";
import { getDefaultSpeedAttribute } from "./systems.js";

// ----- Set up sockets for changing effects on tokens and creating a dialog ----- //
// Don't pass complex classes through the socket. Use token ids instead.

export async function addTerrainEffect(tokenUUID, effectId) {
  const terrain = Terrain.fromEffectId(effectId);
  return terrain._effectHelper.addToToken(tokenUUID);
}

export async function removeTerrainEffect(tokenUUID, effectId) {
  const terrain = Terrain.fromEffectId(effectId);
  return terrain._effectHelper.removeFromToken(tokenUUID);
}


/**
 * Subclass of Map that manages terrain ids and ensures only 1–31 are used.
 */
export class TerrainMap extends Map {
  /** @type {number} */
  MAX_TERRAINS = Math.pow(2, 5) - 1; // No 0 id.

  /** @type {number} */
  #nextId = 1;

  /** @type {Map} */
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

    if ( id > this.MAX_TERRAINS ) { console.warn(`Id ${id} exceeds maximum terrains (${this.MAX_TERRAINS}).`); }

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
    if ( id > this.MAX_TERRAINS ) { console.warn(`Id ${id} exceeds maximum terrains (${this.MAX_TERRAINS}).`); }
    super.set(id, terrain);
    this.terrainIds.set(terrain.id, terrain);
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
    keys.unshift(0); // For arrays like [3, 4, 6] so it returns 0 as the key.
    const lastConsecutiveKey = keys.find((k, idx) => keys[idx + 1] !== k + 1);
    return lastConsecutiveKey + 1 ?? 1;
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
   * Get the key for a given value.
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

/**
 * Terrain data is used here, but ultimately stored in flags in an active effect in a hidden item,
 * comparable to what DFred's does. The active effect can be used to apply the terrain to a token,
 * imposing whatever restrictions are desired.
 * Scenes store a TerrainMap that links each terrain to a pixel value.
 */
export class Terrain {
  /** @type {number} */
  #pixelValue = 0;

  /** @type {TerrainMap} */
  static #sceneMap;

  /** @type {Lock} */
  static lock = new Lock();

  /**
   * @typedef {Object} TerrainConfig          Terrain configuration data
   * @property {string} name                  User-facing name of the terrain.
   * @property {string} icon                  URL of icon representing the terrain
   * @property {hex} color                    Hex value for the color representing the terrain
   * @property {FLAGS.ANCHOR.CHOICES} anchor  Measure elevation as fixed, from terrain, or from layer.
   * @property {number} offset                Offset elevation from anchor
   * @property {number} rangeAbove            How far above the offset the terrain extends
   * @property {number} rangeBelow            How far below the offset the terrain extends
   * @property {boolean} userVisible          Is this terrain visible to the user?
   * @property {ActiveEffect} activeEffect    Active effect associated with this terrain
   */

  /** @type {Settings} */
  _settings;

  /**
   * @param {TerrainConfig} config
   * @param {object} [opts]
   * @param {boolean} [opts.override=false]     Should this terrain replace an existing id?
   */
  constructor(activeEffect, checkExisting = true) {
    if ( checkExisting && activeEffect ) {
      const terrain = this.constructor.sceneMap.terrainIds.get(activeEffect.id);
      if ( terrain ) return terrain;
    }

    this._effectHelper = new EffectHelper(activeEffect);
  }

  /**
   * Construct a Terrain given an effect id.
   * @param {string} id   Active effect id
   * @returns {Terrain}  Either an existing scene terrain or a new terrain.
   */
  static fromEffectId(id, checkExisting = true) {
    if ( checkExisting && this.sceneMap.terrainIds.has(id) ) return this.sceneMap.terrainIds.get(id);
    return new this(EffectHelper.getTerrainEffectById(id), checkExisting);
  }

  /**
   * Load the scene terrain map.
   * @returns {TerrainMap}
   */
  static loadSceneMap() {
    const mapData = canvas.scene.getFlag(MODULE_ID, FLAGS.TERRAIN_MAP);
    const map = new TerrainMap();
    map.set(0, new Terrain());
    if ( !mapData ) return map;
    mapData.forEach(([key, effectId]) => {
      const terrain = this.fromEffectId(effectId, false);
      map.set(key, terrain, true);
    });
    return map;
  }

  /**
   * Save the scene terrain map.
   * @param {TerrainMap}
   */
  static async _saveSceneMap(terrainMap) {
    if ( !terrainMap.size ) return;
    const mapData = [...terrainMap.entries()].map(([key, terrain]) => [key, terrain.id]);
    await canvas.scene.setFlag(MODULE_ID, FLAGS.TERRAIN_MAP, mapData);
  }

  static async saveSceneMap() {
    if ( !this.#sceneMap ) return;
    await this._saveSceneMap(this.#sceneMap);
  }

  static get sceneMap() { return this.#sceneMap || (this.#sceneMap = this.loadSceneMap()); }

  get sceneMap() { return this.constructor.sceneMap; }

  /**
   * @param {TerrainConfig} config
   */
  async initialize(config) {
    await this._effectHelper.initialize(config);
  }

  // NOTE: ----- Static methods -----

  /**
   * Load all terrains stored in the TerrainsItem.
   * @returns {Terrain[]}
   */
  static getAll() {
    const effects = EffectHelper.getAll();
    const terrains = effects.map(e => new this(e));
    return terrains;
  }

  // NOTE: ----- Getters/Setters -----

  /** @type {ActiveEffect} */
  get activeEffect() { return this._effectHelper.effect; }

  /** @type {string} */
  get name() { return this.activeEffect?.name || game.i18n.localize(`${MODULE_ID}.phrases.no-terrain`); }

  set name(value) { this.activeEffect.name = value; }

  /** @type {string} */
  get description() { return this.activeEffect.description; }

  set description(value) { this.activeEffect.description = value; }

  /** @type {string} */
  get icon() { return this.activeEffect?.icon || null; }

  set icon(value) { this.activeEffect.icon = value; }

  /** @type {string} */
  get id() { return this.activeEffect?.id || ""; }

  /** @type {string} */
  get uuid() { return this.activeEffect.uuid; }

  /** @type {FLAGS.ANCHOR.CHOICES} */
  get anchor() { return this.#getAEFlag(FLAGS.ANCHOR.VALUE); }

  set anchor(value) { this.#setAEFlag(FLAGS.ANCHOR.VALUE, value); }

  async setAnchor(value) { return this.#setAEFlag(FLAGS.ANCHOR, value); }

  /** @type {number} */
  get offset() { return this.#getAEFlag(FLAGS.OFFSET); }

  set offset(value) { this.#setAEFlag(FLAGS.OFFSET, value); }

  async setOffset(value) { return this.#setAEFlag(FLAGS.OFFSET, value); }

  /** @type {number} */
  get rangeBelow() { return this.#getAEFlag(FLAGS.RANGE_BELOW); }

  set rangeBelow(value) { this.#setAEFlag(FLAGS.RANGE_BELOW, value); }

  async setRangeBelow(value) { return this.#setAEFlag(FLAGS.RANGE_BELOW, value); }

  /** @type {number} */
  get rangeAbove() { return this.#getAEFlag(FLAGS.RANGE_ABOVE); }

  set rangeAbove(value) { this.#setAEFlag(FLAGS.RANGE_ABOVE, value); }

  async setRangeAbove(value) { return this.#setAEFlag(FLAGS.RANGE_ABOVE, value); }

  /** @type {boolean} */
  get userVisible() { return this.#getAEFlag(FLAGS.USER_VISIBLE); }

  set userVisible(value) { this.#setAEFlag(FLAGS.USER_VISIBLE, value); }

  async setUserVisible(value) { return this.#setAEFlag(FLAGS.USER_VISIBLE, value); }

  /** @type {string} */
  get color() { return this.#getAEFlag(FLAGS.COLOR) ?? 0x000000; }

  set color(value) { this.#setAEFlag(FLAGS.COLOR, value); }

  async setColor(value) { return this.#setAEFlag(FLAGS.COLOR, value); }

  /** @type {number} */
  get pixelValue() {
    return this.#pixelValue || (this.#pixelValue = this.constructor.sceneMap.keyForValue(this));
  }

  // Helpers to get/set the active effect flags.
  #getAEFlag(flag) { return this.activeEffect?.getFlag(MODULE_ID, flag); }

  async #setAEFlag(flag, value) { return this.activeEffect?.setFlag(MODULE_ID, flag, value); }


  // NOTE: ----- Scene map -----

  /**
   * Is this terrain in the scene map?
   * @returns {boolean}
   */
  isInSceneMap() { return this.sceneMap.hasTerrainId(this.id); }

  /**
   * Is this terrain actually used on the scene canvas?
   * @returns {boolean}
   */
  isUsedInScene() { return canvas.terrain.pixelValueInScene(this.pixelValue); }

  /**
   * Get the walk value for the given token as if this terrain were applied.
   */
  movementSpeedForToken(token) {
    const attr = getDefaultSpeedAttribute();
    const speed = getProperty(token, attr) ?? 0;
    const ae = this._effectHelper.effect;
    if ( !ae ) return speed;

    // Locate the change to the movement in the active effect.
    const keyArr = attr.split(".");
    keyArr.shift();
    const key = keyArr.join(".");
    const change = ae.changes.find(e => e.key === key);
    if ( !change ) return speed;

    // Apply the change effect to the token actor and return the result.
    const res = applyEffectTemporarily(ae, token.actor, change);
    return res[key];
  }


  async addToScene() {
    if ( this.isInSceneMap() ) return;
    this.#pixelValue = this.sceneMap.add(this);
    await this.constructor.saveSceneMap();

    // Refresh the UI for the terrain.
    canvas.terrain._terrainColorsMesh.shader.updateTerrainColors();
    if ( ui.controls.activeControl === "terrain" ) ui.controls.render();
    TerrainEffectsApp.rerender();
  }

  async removeFromScene() {
    if ( !this.isInSceneMap() ) return;

    // Remove the pixel key from the scene map.
    const key = this.pixelValue;
    if ( key ) this.sceneMap.delete(key);
    await this.constructor.saveSceneMap();

    // Refresh the UI for the terrain.
    canvas.terrain._terrainColorsMesh.shader.updateTerrainColors();
    if ( canvas.terrain.toolbar.currentTerrain === this ) canvas.terrain.toolbar._currentTerrain = undefined;
    if ( ui.controls.activeControl === "terrain" ) ui.controls.render();
    TerrainEffectsApp.rerender();
  }

  /* ----- NOTE: Terrain functionality ----- */

  getAnchorElevation({ terrainElevation = 0, layerElevation = 0 } = {}) {
    switch ( this.anchor ) {
      case FLAGS.CHOICES.ABSOLUTE: return 0;
      case FLAGS.CHOICES.RELATIVE_TO_TERRAIN: return terrainElevation;
      case FLAGS.CHOICES.RELATIVE_TO_LAYER: return layerElevation;
    }
  }

  /**
   * Calculate the elevation min / max for a given anchor elevation.
   * @returns {object} Elevation min and max.
   *   - {number} min   Minimum elevation
   *   - {number} max   Maximum elevation
   */
  _elevationMinMaxForAnchorElevation(anchorE) {
    const { offset, rangeBelow, rangeAbove } = this;
    const e = anchorE + offset;
    return { min: e + rangeBelow, max: e + rangeAbove };
  }

  /**
   * Determine if the terrain is active at the provided elevation.
   * @param {number} elevation
   * @returns {boolean}
   */
  activeAt(elevation, { point, terrainElevation, anchorElevation } = {}) {
    const layerElevation = 0;
    if ( typeof terrainElevation === "undefined"
      && point ) terrainElevation = canvas.elevation?.elevationAt(point);
    terrainElevation ||= 0;
    anchorElevation ??= this.getAnchorElevation({ terrainElevation, layerElevation });
    const minMaxE = this._elevationMinMaxForAnchorElevation(anchorElevation);
    return elevation.between(minMaxE.min, minMaxE.max);
  }

  /**
   * Add this terrain's effect to the token.
   * @param {Token} token
   * @param {boolean} [duplicate=false]     If false, don't add if already present.
   */
  async addToToken(token, { duplicate = false, removeSceneTerrains = false, removeAllTerrains = false } = {}) {
    await this.constructor.lock.acquire();
    let currTerrains = new Set(this.constructor.getAllOnToken(token));
    if ( duplicate || !currTerrains.has(this) ) {
      console.debug(`Adding ${this.name} terrain to ${token.name}.`);
      await SOCKETS.socket.executeAsGM("addTerrainEffect", token.document.uuid, this.id);
    }

    // Remove other terrains from the token.
    if ( removeSceneTerrains ) currTerrains = currTerrains.filter(t => this.sceneMap.hasTerrainId(t.id));
    if ( removeSceneTerrains || removeAllTerrains ) {
      currTerrains.delete(this);
      for ( const terrain of currTerrains ) {
        console.debug(`Removing ${terrain.name} terrain from ${token.name}.`);
        await SOCKETS.socket.executeAsGM("removeTerrainEffect", token.document.uuid, terrain.id);
      }
    }
    await this.constructor.lock.release();
  }

  /**
   * Remove this terrain's effect from the token.
   * @param {Token} token
   * @param {boolean} [all=true]    If false, remove a single effect if duplicated.
   */
  async removeFromToken(token, all = true) {
    await this.constructor.lock.acquire();
    const currTerrains = new Set(this.constructor.getAllOnToken(token));
    if ( currTerrains.has(this) ) {
      console.debug(`Removing ${this.name} terrain from ${token.name}.`);
      await SOCKETS.socket.executeAsGM("removeTerrainEffect", token.document.uuid, this.id);
    }
    await this.constructor.lock.release();
  }

  /**
   * Remove all scene effects from the token.
   * @param {Token} token
   */
  static async removeAllSceneTerrainsFromToken(token) {
    await this.lock.acquire();
    const terrains = new Set(this.getAllSceneTerrainsOnToken(token));
    const promises = [];
    const uuid = token.document.uuid;
    for ( const terrain of terrains ) {
      console.debug(`removeAllFromToken|Removing ${terrain.name} from ${token.name}.`);
      promises.push(SOCKETS.socket.executeAsGM("removeTerrainEffect", uuid, terrain.id));
    }
    await Promise.allSettled(promises);
    await this.lock.release();
  }

  /**
   * Remove all terrain effects from the token.
   * @param {Token} token
   */
  static async removeAllFromToken(token) {
    await this.lock.acquire();
    const terrains = this.getAllOnToken(token);
    const promises = [];
    const uuid = token.document.uuid;
    for ( const terrain of terrains ) {
      console.debug(`removeAllFromToken|Removing ${terrain.name} from ${token.name}.`);
      promises.push(SOCKETS.socket.executeAsGM("removeTerrainEffect", uuid, terrain.id));
    }
    await Promise.allSettled(promises);
    await this.lock.release();
  }

  /**
   * Get all terrains currently on the token.
   * @param {Token} token
   * @returns {Terrain[]}
   */
  static getAllOnToken(token) {
    console.debug(`Getting all terrains on ${token.name}.`);
    const allEffects = token.actor?.appliedEffects;
    if ( !allEffects ) return [];
    const terrainEffects = allEffects.filter(e => {
      if ( !e.flags ) return false;
      return Object.hasOwn(e.flags, MODULE_ID);
    });
    return terrainEffects.map(e => {
      const id = e.origin.split(".")[1];
      return this.fromEffectId(id);
    });
  }

  /**
   * Get all scene terrains currently on the token.
   * @param {Token} token
   * @returns {Terrain[]}
   */
  static getAllSceneTerrainsOnToken(token) {
    return this.getAllOnToken(token).filter(t => this.sceneMap.hasTerrainId(t.id));
  }

  /**
   * Test if a token has this terrain already.
   * @param {Token} token
   * @returns {boolean}
   */
  tokenHasTerrain(token) {
    const tokenTerrains = new Set(this.constructor.getAllOnToken(token));
    return tokenTerrains.has(this);
  }

  // NOTE: ---- File in/out -----

  toJSON() {
    return this.activeEffect.toJSON();
  }

  updateSource(json) {
    const config = this.config;
    for ( const [key, value] of Object.entries(json) ) {
      if ( key === "id" ) continue;
      if ( key === "activeEffect" ) {
        config.activeEffect = config.activeEffect ? config.activeEffect.updateSource(value) : new ActiveEffect(value);
        continue;
      }
      config[key] = value;
    }
  }

  /**
   * Export the entire terrains item to JSON.
   */
  static exportToJSON() {
    const item = Settings.terrainEffectsItem;
    const data = item.toJSON();
    data.flags.exportSource = {
      world: game.world.id,
      system: game.system.id,
      coreVersion: game.version,
      systemVersion: game.system.version,
      terrainMapperVersion: game.modules.get(MODULE_ID).version
    };
    const filename = `${MODULE_ID}_terrains`;
    saveDataToFile(JSON.stringify(data, null, 2), "text/json", `${filename}.json`);
  }

  /**
   * Import the entire terrains item and replace the existing.
   */
  static async replaceFromJSON(json) {
    const item = Settings.terrainEffectsItem;
    await item.importFromJSON(json);
    // TODO: Replace scene terrain map(s)?

  }

  /**
   * Import the entire terrains item and add all effects as additional terrains to the existing.
   */
  static async importFromJSON(json) {
    const item = Settings.terrainEffectsItem;
    const tmp = CONFIG.Item.documentClass.fromJSON(json);

    // Transfer the active effects to the existing item.
    await item.createEmbeddedDocuments("ActiveEffect", tmp.effects.toObject());
    // await tmp.delete();
  }

  /**
   * Dialog to confirm that import should occur.
   */
  static async importFromJSONDialog() {
    // See https://github.com/DFreds/dfreds-convenient-effects/blob/c2d5e81eb1d28d4db3cb0889c22a775c765c24e3/scripts/effects/custom-effects-handler.js#L156
    const content = await renderTemplate("templates/apps/import-data.html", {
      hint1: "You may import terrain settings data from an exported JSON file.",
      hint2: "This operation will add the terrains in the JSON to the existing terrains set."
    });

    const importPromise = new Promise((resolve, _reject) => {
      new Dialog({
        title: "Import Multiple Terrains Setting Data",
        content,
        buttons: {
          import: {
            icon: '<i class="fas fa-file-import"></i>',
            label: "Import",
            callback: html => {
              const form = html.find("form")[0];
              if ( !form.data.files.length ) return ui.notifications.error("You did not upload a data file!");
              readTextFromFile(form.data.files[0]).then(json => this.importFromJSON(json));
              resolve(true);
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
    });

    await importPromise;
    TerrainEffectsApp.rerender();
  }

  /**
   * Dialog to confirm that replacement should occur.
   */
  static async replaceFromJSONDialog() {
    // See https://github.com/DFreds/dfreds-convenient-effects/blob/c2d5e81eb1d28d4db3cb0889c22a775c765c24e3/scripts/effects/custom-effects-handler.js#L156
    const content = await renderTemplate("templates/apps/import-data.html", {
      hint1: "You may replace terrain settings data using an exported JSON file.",
      hint2: "WARNING: This operation will replace all terrain settings data and cannot be undone."
    });

    const importPromise = new Promise((resolve, _reject) => {
      new Dialog({
        title: "Replace All Terrain Setting Data",
        content,
        buttons: {
          import: {
            icon: '<i class="fas fa-file-import"></i>',
            label: "Import",
            callback: html => {
              const form = html.find("form")[0];
              if ( !form.data.files.length ) return ui.notifications.error("You did not upload a data file!");
              readTextFromFile(form.data.files[0]).then(json => this.replaceFromJSON(json));
              resolve(true);
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
    });

    await importPromise;
    TerrainEffectsApp.rerender();
  }

  exportToJSON() {
    const data = this.activeEffect.toJSON();
    data.flags.exportSource = {
      world: game.world.id,
      system: game.system.id,
      coreVersion: game.version,
      systemVersion: game.system.version,
      terrainMapperVersion: game.modules.get(MODULE_ID).version
    };

    const filename = `${MODULE_ID}_${this.name}`;
    saveDataToFile(JSON.stringify(data, null, 2), "text/json", `${filename}.json`);
  }

  async importFromJSON(json) {
    await this.activeEffect.importFromJSON(json);
  }

  async importFromJSONDialog() {
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



/**
 * Apply this ActiveEffect to a provided Actor temporarily.
 * Same as ActiveEffect.prototype.apply but does not change the actor.
 * @param {ActiveEffect} ae               The active effect to apply
 * @param {Actor} actor                   The Actor to whom this effect should be applied
 * @param {EffectChangeData} change       The change data being applied
 */
function applyEffectTemporarily(ae, actor, change) {
    // Determine the data type of the target field
    const current = foundry.utils.getProperty(actor, change.key) ?? null;
    let target = current;
    if ( current === null ) {
      const model = game.model.Actor[actor.type] || {};
      target = foundry.utils.getProperty(model, change.key) ?? null;
    }
    let targetType = foundry.utils.getType(target);

    // Cast the effect change value to the correct type
    let delta;
    try {
      if ( targetType === "Array" ) {
        const innerType = target.length ? foundry.utils.getType(target[0]) : "string";
        delta = ae._castArray(change.value, innerType);
      }
      else delta = ae._castDelta(change.value, targetType);
    } catch(err) {
      console.warn(`Actor [${actor.id}] | Unable to parse active effect change for ${change.key}: "${change.value}"`);
      return;
    }

    // Apply the change depending on the application mode
    const modes = CONST.ACTIVE_EFFECT_MODES;
    const changes = {};
    switch ( change.mode ) {
      case modes.ADD:
        ae._applyAdd(actor, change, current, delta, changes);
        break;
      case modes.MULTIPLY:
        ae._applyMultiply(actor, change, current, delta, changes);
        break;
      case modes.OVERRIDE:
        ae._applyOverride(actor, change, current, delta, changes);
        break;
      case modes.UPGRADE:
      case modes.DOWNGRADE:
        ae._applyUpgrade(actor, change, current, delta, changes);
        break;
      default:
        ae._applyCustom(actor, change, current, delta, changes);
        break;
    }
    return changes;

}
