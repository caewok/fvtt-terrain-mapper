/* globals
Color,
CONFIG,
CONST,
Dialog,
foundry,
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
import { log } from "./util.js";
import { Settings } from "./settings.js";
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
 * Terrain data is used here, but ultimately stored in flags in an active effect in a hidden item,
 * comparable to what DFred's does. The active effect can be used to apply the terrain to a token,
 * imposing whatever restrictions are desired.
 * Scenes store a TerrainMap that links each terrain to a pixel value.
 */
export class Terrain {

  static _instances = new Map();

  /** @type {number} */
  static #MAX_TERRAINS = Math.pow(2, 4) - 1;

  static get MAX_TERRAINS() { return this.#MAX_TERRAINS; }

  /** @type {number} */
  #pixelValue = 0;

  /** @type {Lock} */
  static lock = new Lock();

  /**
   * @typedef {Object} TerrainConfig          Terrain configuration data
   * @property {string} name                  User-facing name of the terrain.
   * @property {string} img                   URL of icon representing the terrain
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
   * @param {ActiveEffect} activeEffect
   */
  constructor(activeEffect) {
    if ( activeEffect ) {
      const instances = this.constructor._instances;
      const id = activeEffect._id;
      if (instances.has(id) ) return instances.get(id);
      instances.set(id, this);
    }
    this._effectHelper = new EffectHelper(activeEffect);
  }

  /**
   * Construct a Terrain given an effect id.
   * @param {string} id   Active effect id
   * @returns {Terrain}  Either an existing scene terrain or a new terrain.
   */
  static fromEffectId(id) {
    return new this(EffectHelper.getTerrainEffectById(id));
  }


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
  get id() { return this.activeEffect?._id || ""; }

  /** @type {string} */
  get uuid() { return this.activeEffect.uuid; }

  /** @type {string} */
  get name() { return this.activeEffect?.name || game.i18n.localize(`${MODULE_ID}.phrases.no-terrain`); }

  async setName(value) { return this.activeEffect.update({ name: value }); }

  /** @type {string} */
  get description() { return this.activeEffect.description; }

  async setDescription(value) { return this.activeEffect.update({ description: value }); }

  /** @type {string} */
  get img() { return this.activeEffect?.img || null; }

  async setImg(value) { return this.activeEffect.update({ img: value }); }

  /** @type {alias} */
  get icon() { return this.img; }

  async setIcon(value) { return this.setImg(value); }

  /** @type {FLAGS.ANCHOR.CHOICES} */
  get anchor() { return this.#getAEFlag(FLAGS.ANCHOR.VALUE) || FLAGS.ANCHOR.CHOICES.ABSOLUTE; }

  async setAnchor(value) { return this.#setAEFlag(FLAGS.ANCHOR, value); }

  /** @type {number} */
  get offset() { return this.#getAEFlag(FLAGS.OFFSET) || 0; }

  async setOffset(value) { return this.#setAEFlag(FLAGS.OFFSET, value); }

  /** @type {number} */
  get rangeBelow() { return this.#getAEFlag(FLAGS.RANGE_BELOW) || 0; }

  async setRangeBelow(value) { return this.#setAEFlag(FLAGS.RANGE_BELOW, value); }

  /** @type {number} */
  get rangeAbove() { return this.#getAEFlag(FLAGS.RANGE_ABOVE) || 0; }

  async setRangeAbove(value) { return this.#setAEFlag(FLAGS.RANGE_ABOVE, value); }

  /** @type {boolean} */
  get userVisible() { return this.#getAEFlag(FLAGS.USER_VISIBLE) || false; }

  async setUserVisible(value) { return this.#setAEFlag(FLAGS.USER_VISIBLE, value); }

  get duplicatesAllowed() { return this.#getAEFlag(FLAGS.DUPLICATES_ALLOWED) || false; }

  /** @type {Color} */
  get color() {
    return Color.from(this.#getAEFlag(FLAGS.COLOR) ?? 0x000000);
  }

  async setColor(value) {
    value = Color.from(value);
    return this.#setAEFlag(FLAGS.COLOR, Number(value));
  }

  /** @type {number} */
  get pixelValue() {
    return this.#pixelValue
  }

  // Helpers to get/set the active effect flags.
  #getAEFlag(flag) { return this.activeEffect?.getFlag(MODULE_ID, flag); }

  async #setAEFlag(flag, value) { return this.activeEffect?.setFlag(MODULE_ID, flag, value); }

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
  async addToToken(token, { removeOtherSceneTerrains = false, removeAllOtherTerrains = false } = {}) {

    await this.constructor.lock.acquire();
    let currTerrains = new Set(this.constructor.allOnToken(token));
    if ( this.duplicatesAllowed || !currTerrains.has(this) ) {
      log(`Adding ${this.name} terrain to ${token.name}.`);
      await SOCKETS.socket.executeAsGM("addTerrainEffect", token.document.uuid, this.id);
    }

    // Remove other terrains from the token.
//     if ( removeOtherSceneTerrains ) currTerrains = currTerrains.filter(t => this.sceneMap.hasTerrainId(t.id));
    if ( removeOtherSceneTerrains || removeAllOtherTerrains ) {
      currTerrains.delete(this);
      for ( const terrain of currTerrains ) {
        log(`Removing ${terrain.name} terrain from ${token.name}.`);
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
      log(`Removing ${this.name} terrain from ${token.name}.`);
      await SOCKETS.socket.executeAsGM("removeTerrainEffect", token.document.uuid, this.id);
    }
    await this.constructor.lock.release();
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
      log(`removeAllFromToken|Removing ${terrain.name} from ${token.name}.`);
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
    log(`Getting all terrains on ${token.name}.`);
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
   * @returns {number} Percent of the distance between origin and destination
   */
  static percentMovementForTokenAlongPath(_token, _origin, _destination, _speedAttribute) {
    console.error("percentMovementForTokenAlongPath is currently not implemented for v12.");
  }

  /**
   * Percent change in token's move speed when adding specified terrains to the token.
   * Ignores terrains already on the token. Assumes if the terrain is on the token but
   * not in the set, it should be removed.
   * @param {Token} token
   * @param {Set<Terrain>} terrainSet       Terrains to add to the token. Pass empty set to remove all terrains
   * @param {string} [speedAttribute]       Optional attribute to use to determine token speed
   * @param {Set<Terrain>} [currTerrains]   If not defined, set to all terrains on the token
   *   Mostly used for speed in loops.
   * @returns {number} Percent change from token's current speed.
   */
  static percentMovementChangeForTerrainSet(token, terrainSet, speedAttribute, currTerrains) {
    speedAttribute ??= getDefaultSpeedAttribute();
    currTerrains ??= new Set(token.getAllTerrains());
    const droppedTerrains = currTerrains.difference(terrainSet);
    const addedTerrains = terrainSet.difference(currTerrains);

    // If movementPercentChangeForToken returns the same value, map would fail. See issue #21.
    const percentDropped = droppedTerrains.reduce((acc, curr) =>
      acc * curr.movementPercentChangeForToken(token, speedAttribute), 1);
    const percentAdded = addedTerrains.reduce((acc, curr) =>
      acc * curr.movementPercentChangeForToken(token, speedAttribute), 1);
    return (1 / (percentAdded * (1 / percentDropped)));
  }

  /**
   * Percent movement for the token at a given point on the canvas. Relies on the token's elevation.
   * @param {Token} token               Token to test
   * @param {Point} [location]          If not provided, taken from token center
   * @param {string} [speedAttribute]   Optional attribute to use to determine token speed
   * @returns {number} The percent increase or decrease from default speed attribute.
   *   Greater than 100: increase. E.g. 120% is 20% increase over baseline.
   *   Equal to 100: no increase.
   *   Less than 100: decrease.
   */
  static percentMovementChangeForTokenAtPoint(_token, _location, _speedAttribute) {
    console.error("percentMovementChangeForTokenAtPoint is currently not implemented for v12.");
  }

  /**
   * Percent movement for the token for a given shape on the canvas. Relies on the token's elevation.
   * If the terrain covers more than minPercentArea, it counts as active assuming it is within elevation.
   *
   * @param {Token} token
   * @param {Point} [shape]       Shape to test, if not the constrained token boundary
   * @param {object} [opts]       Options that affect the measurement
   * @param {number} [opts.minPercentArea]    Minimum percent area of the shape that the terrain must overlap to count
   * @param {string} [opts.speedAttribute]    String pointing to where to find the token speed attribute
   * @returns {number} The percent increase or decrease from default speed attribute.
   *   Greater than 100: increase. E.g. 120% is 20% increase over baseline.
   *   Equal to 100: no increase.
   *   Less than 100: decrease.
   */

  static percentMovementChangeForTokenWithinShape(_token, _shape, _minPercentArea = 0.5, _speedAttribute, _elevationE) {
    console.error("percentMovementChangeForTokenWithinShape is currently not implemented for v12.");
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
    log("importFromJSON|Created effects");
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
              log("importFromJSONDialog|Read text");
              await this.importFromJSON(json);
              TerrainEffectsApp.rerender();
              log("importFromJSONDialog|Finished rerender");
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
    log("importFromJSONDialog|returned from dialog");
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
  } catch(_err) { // eslint-disable-line no-unused-vars
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
