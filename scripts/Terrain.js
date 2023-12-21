/* globals
canvas,
Color,
CONFIG,
CONST,
Dialog,
foundry,
game,
getProperty,
PIXI,
readTextFromFile,
renderTemplate,
saveDataToFile,
ui
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { FLAGS, MODULE_ID, SOCKETS } from "./const.js";
import { Settings } from "./settings.js";
import { EffectHelper } from "./EffectHelper.js";
import { TerrainEffectsApp } from "./TerrainEffectsApp.js";
import { Lock } from "./Lock.js";
import { getDefaultSpeedAttribute } from "./systems.js";
import { TravelTerrainRay } from "./TravelTerrainRay.js";
import { TerrainListConfig } from "./TerrainListConfig.js";

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
 * Terrain data is used here, but ultimately stored in flags in an active effect in a hidden item,
 * comparable to what DFred's does. The active effect can be used to apply the terrain to a token,
 * imposing whatever restrictions are desired.
 * Scenes store a TerrainMap that links each terrain to a pixel value.
 */
export class Terrain {

  /** @type {number} */
  static #MAX_TERRAINS = Math.pow(2, 4) - 1;

  static get MAX_TERRAINS() { return this.#MAX_TERRAINS; }

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
      const terrain = this.sceneMap.terrainIds.get(activeEffect.id);
      if ( terrain ) return terrain; // eslint-disable-line no-constructor-return
    }

    this._effectHelper = new EffectHelper(activeEffect);
  }

  /**
   * Construct a Terrain given an effect id.
   * @param {string} id   Active effect id
   * @returns {Terrain}  Either an existing scene terrain or a new terrain.
   */
  static fromEffectId(id, checkExisting = true) {
    const terrainIds = canvas.terrain.sceneMap.terrainIds;
    if ( checkExisting && terrainIds.has(id) ) return terrainIds.get(id);
    return new this(EffectHelper.getTerrainEffectById(id), checkExisting);
  }

  /** @type {TerrainMap} */
  get sceneMap() { return canvas.terrain.sceneMap; }

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
  get id() { return this.activeEffect?.id || ""; }

  /** @type {string} */
  get uuid() { return this.activeEffect.uuid; }

  /** @type {string} */
  get name() { return this.activeEffect?.name || game.i18n.localize(`${MODULE_ID}.phrases.no-terrain`); }

  async setName(value) { return this.activeEffect.update({ name: value }); }

  /** @type {string} */
  get description() { return this.activeEffect.description; }

  async setDescription(value) { return this.activeEffect.update({ description: value }); }

  /** @type {string} */
  get icon() { return this.activeEffect?.icon || null; }

  async setIcon(value) { return this.activeEffect.update({ icon: value }); }

  /** @type {FLAGS.ANCHOR.CHOICES} */
  get anchor() { return this.#getAEFlag(FLAGS.ANCHOR.VALUE); }

  async setAnchor(value) { return this.#setAEFlag(FLAGS.ANCHOR, value); }

  /** @type {number} */
  get offset() { return this.#getAEFlag(FLAGS.OFFSET); }

  async setOffset(value) { return this.#setAEFlag(FLAGS.OFFSET, value); }

  /** @type {number} */
  get rangeBelow() { return this.#getAEFlag(FLAGS.RANGE_BELOW); }

  async setRangeBelow(value) { return this.#setAEFlag(FLAGS.RANGE_BELOW, value); }

  /** @type {number} */
  get rangeAbove() { return this.#getAEFlag(FLAGS.RANGE_ABOVE); }

  async setRangeAbove(value) { return this.#setAEFlag(FLAGS.RANGE_ABOVE, value); }

  /** @type {boolean} */
  get userVisible() { return this.#getAEFlag(FLAGS.USER_VISIBLE); }

  async setUserVisible(value) { return this.#setAEFlag(FLAGS.USER_VISIBLE, value); }

  /** @type {Color} */
  get color() {
    return new Color.from(this.#getAEFlag(FLAGS.COLOR) ?? 0x000000);
  }

  async setColor(value) {
    value = Color.from(value);
    return this.#setAEFlag(FLAGS.COLOR, Number(value));
  }

  /** @type {number} */
  get pixelValue() {
    return this.#pixelValue || (this.#pixelValue = this.sceneMap.keyForValue(this));
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
   * Add this terrain to the scene, which assigns a pixel value for this terrain.
   */
  addToScene() { this.#pixelValue = canvas.terrain._addTerrainToScene(this); }

  /**
   * Remove this terrain from the scene, which removes the pixel value for this terrain.
   * (But not necessarily the underlying pixels -- a placeholder terrain will be assigned.)
   */
  async removeFromScene() {
    await canvas.terrain._removeTerrainFromScene(this);
    this.#pixelValue = undefined;
  }

  /**
   * Reset the pixel value.
   * Internal use when cleaning the scene.
   */
  _unassignPixel() {
    if ( this.isInSceneMap() ) console.warn(`Terrain ${this.name} (${this.pixelValue}) is still present in the scene map.`);
    this.#pixelValue = undefined;
  }

  /**
   * Duplicate this terrain.
   * @returns {Terrain}
   */
  async duplicate() {
    const dupe = new Terrain();
    dupe._effectHelper = await this._effectHelper.duplicate();
    await dupe.setName(`${this.name} Copy`);
    return dupe;
  }

  /* ----- NOTE: Terrain functionality ----- */

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

  // ----- NOTE: Token interaction ----- //

  /**
   * Add this terrain's effect to the token.
   * @param {Token} token
   * @param {boolean} [duplicate=false]     If false, don't add if already present.
   */
  async addToToken(token, {
    duplicate = false, removeOtherSceneTerrains = false, removeAllOtherTerrains = false } = {}) {

    await this.constructor.lock.acquire();
    let currTerrains = new Set(this.constructor.allOnToken(token));
    if ( duplicate || !currTerrains.has(this) ) {
    // Debug: console.debug(`Adding ${this.name} terrain to ${token.name}.`);
      await SOCKETS.socket.executeAsGM("addTerrainEffect", token.document.uuid, this.id);
    }

    // Remove other terrains from the token.
    if ( removeOtherSceneTerrains ) currTerrains = currTerrains.filter(t => this.sceneMap.hasTerrainId(t.id));
    if ( removeOtherSceneTerrains || removeAllOtherTerrains ) {
      currTerrains.delete(this);
      for ( const terrain of currTerrains ) {
      // Debug: console.debug(`Removing ${terrain.name} terrain from ${token.name}.`);
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
  async removeFromToken(token, _all = true) {
    await this.constructor.lock.acquire();
    const currTerrains = new Set(this.constructor.allOnToken(token));
    if ( currTerrains.has(this) ) {
    // Debug: console.debug(`Removing ${this.name} terrain from ${token.name}.`);
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
    const terrains = new Set(this.allSceneTerrainsOnToken(token));
    const promises = [];
    const uuid = token.document.uuid;
    for ( const terrain of terrains ) {
    // Debug: console.debug(`removeAllFromToken|Removing ${terrain.name} from ${token.name}.`);
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
    const terrains = this.allOnToken(token);
    const promises = [];
    const uuid = token.document.uuid;
    for ( const terrain of terrains ) {
    // Debug: console.debug(`removeAllFromToken|Removing ${terrain.name} from ${token.name}.`);
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
  static allOnToken(token) {
  // Debug: console.debug(`Getting all terrains on ${token.name}.`);
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
  static allSceneTerrainsOnToken(token) {
    return this.allOnToken(token).filter(t => canvas.terrain.sceneMap.hasTerrainId(t.id));
  }

  /**
   * Test if a token has this terrain already.
   * @param {Token} token
   * @returns {boolean}
   */
  tokenHasTerrain(token) {
    const tokenTerrains = new Set(this.constructor.allOnToken(token));
    return tokenTerrains.has(this);
  }

  /**
   * Walk value for the given token as if this terrain were applied.
   * @param {Token} token
   * @param {string} [speedAttribute]
   * @returns {number} The token's default speed attribute (typically, walk) if the terrain were applied.
   */
  movementSpeedForToken(token, speedAttribute) {
    speedAttribute ??= getDefaultSpeedAttribute();
    const speed = getProperty(token, speedAttribute) ?? 0;
    const ae = this._effectHelper.effect;
    if ( !ae ) return speed;

    // Locate the change to the movement in the active effect.
    const keyArr = speedAttribute.split(".");
    keyArr.shift();
    const key = keyArr.join(".");
    const change = ae.changes.find(e => e.key === key);
    if ( !change ) return speed;

    // Apply the change effect to the token actor and return the result.
    const res = applyEffectTemporarily(ae, token.actor, change);
    return res[key];
  }

  /**
   * Calculate the movement penalty (or bonus) for a token.
   * @param {Token}
   * @param {string} [speedAttribute]
   * @returns {number} The percent increase or decrease from default speed attribute.
   *   Greater than 100: increase. E.g. 120% is 20% increase over baseline.
   *   Equal to 100: no increase.
   *   Less than 100: decrease.
   */
  movementPercentChangeForToken(token, speedAttribute) {
    speedAttribute ??= getDefaultSpeedAttribute();
    const speed = getProperty(token, speedAttribute) ?? 1;
    const effectSpeed = this.movementSpeedForToken(token, speedAttribute) ?? 1;
    return effectSpeed / speed;
  }

  /**
   * Calculate distance for token movement across two points.
   * This is 2d distance that accounts for the speed attribute.
   * @param {Token} token
   * @param {PIXI.Point} origin
   * @param {PIXI.Point} destination
   * @param {string} [speedAttribute]
   */
  static percentMovementForTokenAlongPath(token, origin, destination, speedAttribute) {
    speedAttribute ??= getDefaultSpeedAttribute();
    if ( !(origin instanceof PIXI.Point) ) origin = new PIXI.Point(origin.x, origin.y);
    if ( !(destination instanceof PIXI.Point) ) destination = new PIXI.Point(destination.x, destination.y);

    const currTerrains = new Set(token.getAllTerrains());

    const ttr = new TravelTerrainRay(token, { origin, destination});
    const path = ttr.path;
    let tPrev = 0;
    let prevTerrains = ttr.activeTerrainsAtT(0);
    let percent = 0;
    const nMarkers = path.length;
    const tChangeFn = markerT => {
      const tDiff = markerT - tPrev;
      const droppedTerrains = currTerrains.difference(prevTerrains);
      const addedTerrains = prevTerrains.difference(currTerrains);
      const percentDropped = droppedTerrains.map(t => t.movementPercentChangeForToken(token, speedAttribute))
        .reduce((acc, curr) => acc * curr, 1);
      const percentAdded = addedTerrains.map(t => t.movementPercentChangeForToken(token, speedAttribute))
        .reduce((acc, curr) => acc * curr, 1);
      return (percentAdded * (1 / percentDropped)) * tDiff;
    };

    for ( let i = 1; i < nMarkers; i += 1 ) {
      const marker = path[i];
      const activeTerrains = ttr.activeTerrainsAtT(marker.t);

      // If nothing has changed, combine segments.
      if ( prevTerrains.equals(activeTerrains) ) continue;

      // Measure effect of movement for the terrains across this segment.
      percent += tChangeFn(marker.t);

      // Update for the next segment.
      tPrev = marker.t;
      prevTerrains = activeTerrains;
    }

    // Handle the last segment.
    percent += tChangeFn(1);
    return percent;
  }

  /**
   * Helper to measure

  // NOTE: ---- File in/out -----

  toJSON() {
    return this.activeEffect.toJSON();
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
    return data;
  }

  static saveToJSON() {
    const data = this.exportToJSON();
    const filename = `${MODULE_ID}_terrains`;
    saveDataToFile(JSON.stringify(data, null, 2), "text/json", `${filename}.json`);
  }

  /**
   * Import the entire terrains item and replace the existing.
   */
  static async replaceFromJSON(json) {
    const item = Settings.terrainEffectsItem;
    await item.importFromJSON(json);
  }

  /**
   * Import the entire terrains item and add all effects as additional terrains to the existing.
   */
  static async importFromJSON(json) {
    const item = Settings.terrainEffectsItem;
    const tmp = CONFIG.Item.documentClass.fromJSON(json);

    // Transfer the active effects to the existing item.
    await item.createEmbeddedDocuments("ActiveEffect", tmp.effects.toObject());
    console.debug("importFromJSON|Created effects");
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
            callback: async html => {
              const form = html.find("form")[0];
              if ( !form.data.files.length ) return ui.notifications.error("You did not upload a data file!");
              const json = await readTextFromFile(form.data.files[0]);
              // Debug: console.debug("importFromJSONDialog|Read text");
              await this.importFromJSON(json);
              TerrainEffectsApp.rerender();
              TerrainListConfig.rerender();
              // Debug: console.debug("importFromJSONDialog|Finished rerender");
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
    // Debug: console.debug("importFromJSONDialog|returned from dialog");
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
            callback: async html => {
              const form = html.find("form")[0];
              if ( !form.data.files.length ) return ui.notifications.error("You did not upload a data file!");
              const json = await readTextFromFile(form.data.files[0]);
              await this.replaceFromJSON(json);
              TerrainEffectsApp.rerender();
              TerrainListConfig.rerender();
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
    const effect = this._effectHelper.effect;
    if ( !effect ) return console.error("Terrain|importFromJSON|terrain has no effect)");
    json = JSON.parse(json);
    delete json._id;
    await effect.update(json);
    TerrainEffectsApp.rerender();
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
