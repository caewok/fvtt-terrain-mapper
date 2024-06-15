/* globals
Application,
canvas,
CONST,
foundry,
game,
saveDataToFile
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, FLAGS } from "../const.js";
import { log } from "../util.js";
import { AsyncQueue } from "./AsyncQueue.js";

/* Class structure
AbstractUniqueEffect
 - UniqueActiveEffect
   - TerrainActiveEffect
   - CoverActiveEffect
     - CoverEffectDND5E
     - CoverActiveEffectDFreds
 - UniqueItemEffect
   - TerrainItem
   - CoverItem
     - CoverItemSFRPG
     - CoverItemPF2E (not currently used)
 - UniqueFlags
   - TerrainFlags
   - CoverFlags
     - CoverFlagsDND5E

Mix-ins
- terrain
- cover
*/

/*
Each unique effect is linked to a specific document, referred to here as the "base effect."
Base effects are then applied to a token by creating a new version of that effect on the token.
(Currently, either an AE, Item, or flags.)

Unique effects can be used in a Set. Uniqueness is enforced via a common id in a flag. New base effects
are assigned a random id for the effect. Effects on tokens link back to the base effect via the base effect id.
Base effect ids are associated with a localized name: the document name.
Base effect id: `${MODULE_ID}.${effectType}.${system}.${id}`
  e.g., "terrainmapper.TerrainActiveEffect.dnd5e.fMnmR7WYoddy6EKF"

Construct a unique effect by providing the base effect id. Use the async "create" method
when creating a new base document.

Unique effects are responsible for adding and removing themselves from tokens (typically, actors).

Each class has a defined _storageMap. This is an EmbeddedCollection or Map that holds the
unique effect documents.

*/

/**
 * Abstract class to manage terrain and cover effects
 * One unique instance is created per document id.
 * It is backed by an underlying document handled by child classes.
 * - active effect
 * - item
 * - stored settings object in lieu of either. (not implemented for Terrains)
 * This class handles adding / removing effects to/from tokens.
 * Note that effects stored to tokens have distinct ids.
 */
export class AbstractUniqueEffect {
  /** @type {string} */
  uniqueEffectId = "";

  /** @type {Map<string, AbstractTerrain} */
  static _instances = new Map();

  /** @type {string} */
  static type = "UniqueEffect";

  /**
   * @param baseEffectId
   */
  constructor(uniqueEffectId) {
    this.uniqueEffectId = uniqueEffectId ?? this.constructor.uniqueEffectId();

    // Enforce singleton.
    const instances = this.constructor._instances;
    if ( instances.has(uniqueEffectId) ) return instances.get(uniqueEffectId);
    instances.set(this.uniqueEffectId, this);
  }

  /**
   * Create a new unique effect. To be used instead of the constructor in most situations.
   * If the storage document is local, constructor can be used instead.
   * @param {string} id                     Optional id to use for this cover object.
   *                                          Cover objects are singletons, so if this id is recognized,
   *                                          an existing object will be returned.
   * @return {AbstractUniqueEffect}
   */
  static async create(uniqueEffectId) {
    const obj = new this(uniqueEffectId);
    await obj.initializeDocument();
    return obj
  }

  // ----- NOTE: Getters, setters, related properties ----- //

  /** @type {EmbeddedCollection|Map} */
  static _storageMap;

  /** @type {Document|Object} */
  #document;

  get document() { return this.#document || (this.#document = this._findLocalDocument)}

  get allowDuplicates() {
    return this.document?.getFlag(MODULE_ID, FLAGS.UNIQUE_EFFECT.DUPLICATES_ALLOWED)
      ?? this.document.allowDuplicates;
  }

  /**
   * Data to construct an effect.
   */
  get effectData() {
    const data = this.document?.toObject() || foundry.utils.duplicate(this.document);
    data.flags[MODULE_ID] ??= {};
    data.flags[MODULE_ID][FLAGS.UNIQUE_EFFECT.ID] = this.uniqueEffectId;
    data.flags[MODULE_ID][FLAGS.UNIQUE_EFFECT.TYPE] = this.constructor.type
    return data;
  }

  /**
   * Data used when dragging an effect to an actor sheet.
   */
  get dragData() {
    return {
      name: this.document.name,
      data: this.effectData
    }
  }

  /**
   * Data to construct a local effect.
   * Local cover effects have the local flag.
   * @type {object}
   */
  get localEffectData() {
    const data = this.effectData;
    data.flags[MODULE_ID][FLAGS.UNIQUE_EFFECT.LOCAL] = true;
    return data;
  }

  /** @type {string} */
  get name() { return this.document?.name; }

  /** @type {string} */
  get description() { return this.document?.description; }

  /** @returns {string} */
  get img() { return this.document?.img || this.document?.icon; }

  /** Alias @type{string} */
  get image() { return this.img; }

  /** Alias @type{string} */
  get icon() { return this.img; }


  // ----- NOTE: Document-related methods ----- //

  /**
   * Find or create a document for a given unique effect id.
   * @param {string} uniqueEffectId
   */
  async initializeDocument(uniqueEffectId) {
    uniqueEffectId ??= this.uniqueEffectId;
    this.#document = this._findLocalDocument(uniqueEffectId)
      || (await this._loadDocument(uniqueEffectId))
      || (await this._createNewDocument(uniqueEffectId));
  }

  /**
   * Find an existing effect document to use for the storage.
   * @param {string} uniqueEffectId
   * @returns {Document|object|undefined}
   */
  _findLocalDocument(uniqueEffectId) {
    for ( const doc of this.constructor._storageMap.values() ) {
      if ( doc.getFlag(MODULE_ID, FLAGS.UNIQUE_EFFECT.ID) === uniqueEffectId ) return doc;
    }
  }

  /**
   * Load an async effect document to use for storage.
   * Async allows us to pull from compendiums or otherwise construct a default.
   * @returns {Document|object|undefined}
   */
  async _loadDocument(uniqueEffectId) {
    return this._findLocalDocument(uniqueEffectId);
  }

  /**
   * Create an effect document from scratch.
   * @returns {Document|object}
   */
  async _createNewDocument(_uniqueEffectId) {
    console.error("AbstractUniqueEffect#_createDocument must be defined by child class.");
  }

  /**
   * Update the document for this effect.
   * Typically when importing from JSON.
   * @param {object} [config={}]    Data used to update the document
   */
  async updateDocument(_data) {
    console.error("AbstractUniqueEffect#updateDocument must be defined by child class.");
  }

  /**
   * Delete the underlying stored document.
   */
  async _deleteDocument() {
    console.error("AbstractUniqueEffect#updateDocument must be defined by child class.");
  }

  /**
   * Duplicate the document data for this cover effect and place in a new document.
   * @returns {AbstractUniqueEffect}
   */
  async duplicate() {
    const newObj = await this.constructor.create();
    await newObj.fromJSON(this.toJSON());
    return newObj;
  }

  /**
   * Export this effect to JSON
   * @returns {object}
   */
  toJSON() { return this.document?.toJSON || JSON.stringify(this.document); }

  /**
   * Import this effect from JSON
   * @param {object} json
   */
  async fromJSON(json) {
    try {
      json = JSON.parse(json);
    } catch (err) {
      console.error(`${MODULE_ID}|AbstractUniqueEffect#fromJSON`, err);
      return;
    }
    return this.update(json);
  }

  /**
   * Delete this instance
   * @param {boolean} [deleteDocument=false]  If true, delete the underlying document.
   */
  async destroy(deleteDocument=false) {
    if ( deleteDocument ) await this.constructor._deleteDocument(this.id);
    this.constructor_instances.delete(this.id);
  }

  // ----- NOTE: Token-related methods ----- //

  /**
   * Add this effect to a token.
   * @param {Token } token      Token to add the effect to.
   * @param {object} [opts]     Options to change effects added
   * @param {object} [opts.exclusive=false]   If true, removes all other effects of this type.
   * @returns {boolean} True if change was made.
   */
  async addToToken(token, { exclusive = false } = {}) {
    const currEffects = new Set(this.constructor.allOnToken(token));
    if ( !this.allowDuplicates && currEffects.has(this) ) return false;
    if ( exclusive ) {
      currEffects.delete(this);
      await this.constructor.removeFromToken(token, currEffects, true); // Remove all other effects.
    }
    return this.constructor.addToToken(token, [this]); // Async
  }

  /**
   * Remove this effect from a token.
   * @param {Token } token      Token to remove the effect from.
   * @returns {boolean} True if change was made
   */
  async removeFromToken(token) {
    if ( !this.isOnToken(token) ) return false;
    return this.constructor.removeFromToken(token, [this], !this.allowDuplicates); // Async
  }

  /**
   * Add this effect to a token locally (for the current user) only.
   * @param {Token } token      Token to remove the effect from.
   * @param {object} [opts]     Options to change effects added
   * @param {object} [opts.exclusive=false]   If true, locally removes all other effects of this type.
   * @returns {boolean} True if change was made
   */
  addToTokenLocally(token, { exclusive = false } = {}) {
    const currEffects = new Set(this.constructor.allOnToken(token));
    if ( !this.allowDuplicates && currEffects.has(this) ) return false;
    if ( exclusive ) {
      currEffects.delete(this);
      this.constructor.removeFromTokenLocally(token, currEffects, true); // Remove all other effects.
    }
    return this.constructor.addToTokenLocally(token, [this]);
  }

  /**
   * Remove this effect from a token locally.
   * @param {Token } token      Token to remove the effect from.
   * @returns {boolean} True if change was made
   */
  async removeFromTokenLocally(token) {
    if ( !this.isOnToken(token) ) return false;
    return this.constructor.removeFromTokenLocally(token, [this], !this.allowDuplicates);
  }

  /**
   * Is this effect on the token?
   * @param {Token} token
   * @returns {boolean}
   */
  isOnToken(token) {
    for ( const doc of this.constructor.getTokenStorage(token).values() ) {
      if ( doc.getFlag(MODULE_ID, FLAGS.UNIQUE_EFFECT.ID) === this.id ) return true;
    }
    return false;
  }

  // ----- NOTE: Static token-related methods ----- //

  /**
   * Add multiple effects to the token.
   * This is the only way to add effects to the token; other methods rely on this.
   * Effects may not be added if they would be duplicated.
   * @param {Token } token      Token to add the effects to.
   * @param {AbstractUniqueEffect[]|Set<AbstractUniqueEffect>} effects   Effects to add. Each unique effect may only be added once each call.
   * @returns {boolean} True if change was made.
   */
  static async addToToken(token, effects) {
    const toAdd = this._trimDuplicates(token, effects);
    if ( !toAdd.length ) return false;
    return await this._addToToken(token, toAdd);
  }

  /**
   * Method implemented by child class to add 1+ effects to token locally.
   * @param {Token } token      Token to add the effect(s) to.
   * @param {AbstractUniqueEffect[]|Set<AbstractUniqueEffect>} effects   Effects to add. Each unique effect may only be added once each call.
   * @returns {boolean} True if change was made.
   */
  static addToTokenLocally(token, effects, refresh = true) {
    const toAdd = this._trimDuplicates(token, effects);
    if ( !toAdd.length ) return false;
    if ( !this._addTokenLocally(token, toAdd) ) return false;
    if ( refresh ) this.constructor.refreshTokenDisplay(token)
    return true;
  }

  /**
   * Method implemented by child class to add 1+ effects to the token.
   * Does not consider whether the effect is already present.
   * @param {Token } token      Token to remove the effect from.
   * @param {AbstractUniqueEffect[]} effects   Effects to add; effects already on token may be duplicated
   * @returns {boolean} True if change was made
   */
  static _addToToken(_token, _effects) {
    console.error("AbstractUniqueEffect.addToToken must be implemented by child class.");
    return false;
  }

  /**
   * Method implemented by child class to add 1+ effects to token locally.
   * @param {Token } token      Token to add the effect(s) to.
   * @param {AbstractUniqueEffect[]} effects   Effects to add; effects already on token may be duplicated
   * @returns {boolean} True if change was made
   */
  static _addToTokenLocally(_token, _effects) {
    console.error("AbstractUniqueEffect.addToTokenLocally must be implemented by child class.");
    return false;
  }

  /**
   * Trim duplicate effects from set to add
   * @param {Token } token      Token to add the effects to.
   * @param {AbstractUniqueEffect[]|Set<AbstractUniqueEffect>} effects   Effects to add. Each unique effect may only be added once each call.
   * @returns {AbstractUniqueEffect[]} The trimmed set as an array
   */
  static _trimDuplicates(token, effects) {
    if ( !(effects instanceof Set) ) effects = new Set(effects);
    const currEffects = new Set(this.allOnToken(token));
    const toAdd = [];
    for ( const effect of effects ) {
      if ( currEffects.has(effect) && !effect.allowDuplicates ) continue;
      toAdd.push(effect);
    }
    return toAdd;
  }

  /**
   * Method implemented by child class to add to token.
   * @param {Token } token      Token to remove the effect from.
   * @param {AbstractUniqueEffect[]|Set<AbstractUniqueEffect>} effects   Effects to remove
   * @returns {boolean} True if change was made
   */
  static async removeFromToken(token, effects) {
    if ( !(effects instanceof Set) ) effects = new Set(effects);
    const toRemove = effects.intersection(new Set(this.allOnToken(token)));
    if ( !toRemove.size ) return false;
    return await this._removeFromToken(token, [...toRemove]);
  }

  /**
   * Method implemented by child class to add to token.
   * @param {Token } token      Token to remove the effect from.
   * @param {AbstractUniqueEffect[]|Set<AbstractUniqueEffect>} effects   Effects to remove
   * @returns {boolean} True if change was made
   */
  static removeFromTokenLocally(token, effects, refresh = true) {
    if ( !(effects instanceof Set) ) effects = new Set(effects);
    const toRemove = effects.intersection(new Set(this.allOnToken(token)));
    if ( !toRemove.size ) return false;
    if ( !this._removeFromTokenLocally(token, [...toRemove]) ) return false;
    if ( refresh ) this.constructor.refreshTokenDisplay(token);
    return true;
  }

  /**
   * Method implemented by child class to add to token.
   * @param {Token } token      Token to remove the effect from.
   * @param {AbstractUniqueEffect[]} effects
   * @returns {boolean} True if change was made
   */
  static async _removeFromToken(_token, _effects) {
    console.error("AbstractUniqueEffect.removeFromToken must be implemented by child class.");
    return false;
  }

  /**
   * Method implemented by child class to add to token.
   * @param {Token } token      Token to remove the effect from.
   * @param {AbstractUniqueEffect[]} effects
   * @returns {boolean} True if change was made
   */
  static _removeFromTokenLocally(_token, _effects) {
    console.error("AbstractUniqueEffect.removeFromTokenLocally must be implemented by child class.");
    return false;
  }

  // ----- NOTE: Static document handling ----- //

  /**
   * Construct a new unique effect id.
   * @param {object} [opts]     Parts of the id
   * @returns {string} moduleId.effectType.systemId.baseEffectId
   */
  static uniqueEffectId({ moduleId, type, systemId, baseEffectId } = {}) {
    moduleId ??= MODULE_ID;
    type ??= this.type;
    systemId ??= game.system.id;
    baseEffectId ??= foundry.utils.randomID();
    return [moduleId, type, systemId, baseEffectId].join(".");
  }

  /**
   * Deconstruct the unique effect id.
   * @param {string} uniqueEffectId
   * @returns {object} With moduleId, effectType, systemId, baseEffectId
   */
  static deconstructUniqueEffectId(uniqueEffectId) {
    const [moduleId, effectType, systemId, baseEffectId] = uniqueEffectId;
    return { moduleId, effectType, systemId, baseEffectId };
  }

  /**
   * Get the corresponding unique effect for a given token document.
   * @param {Document|Object} doc     Document or object that has `getFlag` method
   * @returns {AbstractUniqueEffect|undefined} If effect id flag present, returns the effet
   */
  static uniqueEffectForDocument(doc) {
    const uniqueEffectId = doc.getFlag(MODULE_ID, FLAGS.UNIQUE_EFFECT.ID);
    return this._instances.get(uniqueEffectId);
  }

  /**
   * Data to construct a new effect
   */
  static get newEffectData() { return {
    flags: {
      [MODULE_ID]: { [FLAGS.UNIQUE_EFFECT.TYPE]: this.type }
      }
    };
  }

  /**
   * Data to construct an effect from a default source of data.
   */
  static async defaultEffectData(uniqueEffectId) {
    if ( !this.defaultEffectIds().has(uniqueEffectId) ) return;

    const data = this.newEffectData;
    data.flags = { [MODULE_ID]: { [FLAGS.UNIQUE_EFFECT.ID]: uniqueEffectId } }
    // Subclass to handle rest.
    return data;
  }

  /**
   * Data to construct an effect for a specific unique id.
   * @param {string} uniqueEffectId
   */
  static async dataForId(uniqueEffectId) {
    const data = this._instances.get(uniqueEffectId)?.effectData
      ?? (await this.defaultEffectData(uniqueEffectId))
      ?? this.newEffectData;

    data.flags[MODULE_ID][FLAGS.UNIQUE_EFFECT.ID] = uniqueEffectId;
    return data;
  }

  // ----- NOTE: Static token handling ----- //

  /**
   * The token storage for this class
   * @param {Token} token
   * @returns {DocumentCollection|Map} The collection for this token
   */
  static getTokenStorage(_token) { console.error("AbstractUniqueEffect.getTokenStorage must be defined by child class."); }

  /**
   * Get all unique effects on the token.
   * @param {Token} token
   * @returns {AbstractUniqueEffect[]} All effects, possibly repeated
   */
  static allOnToken(token) {
    const instances = [];
    for ( const doc of this.getTokenStorage(token).values() ) {
      const uniqueEffectId = doc.getFlag(MODULE_ID, FLAGS.UNIQUE_EFFECT.ID);
      if ( !uniqueEffectId ) continue;
      const instance = this._instances.get(uniqueEffectId);
      if ( instance ) instances.push(instance);
    }
    return instances;
  }

  /**
   * Transition all documents in a scene, when updating versions.
   */
  static async transitionDocuments() {
    if ( !this._storageMap ) this._storageMap = await this._initializeStorageMap();

    // Transition each of the effects on the storage item
    const storagePromises = [];
    for ( const doc of this._storageMap.values() ) storagePromises.push(this._doStorageTransition(doc));
    const storageConverted = await Promise.allSettled(storagePromises);
    if ( storageConverted.some(elem => elem) ) await this.initialize();

    // Same for all tokens
    const tokenPromises = [];
    for ( const token of canvas.tokens.placeables ) {
      for ( const doc of this.getTokenStorage(token).values() ) tokenPromises.push(this._doTokenTransition(doc));
    }
    await Promise.allSettled(tokenPromises);
  }

  static async _doStorageTransition(doc) {
    const moduleVersion = game.modules.get(MODULE_ID).version;
    const savedVersion = doc.getFlag(MODULE_ID, FLAGS.VERSION);
    if ( savedVersion && !foundry.utils.isNewerVersion(moduleVersion, savedVersion) ) return false;

    // Set the id if not present.
    const uniqueId = doc.getFlag(MODULE_ID, FLAGS.UNIQUE_EFFECT.ID);
    if ( !uniqueId ) await doc.setFlag(MODULE_ID, FLAGS.UNIQUE_EFFECT.ID, this.uniqueEffectId());

    // Child transitions.
    await this._transitionStorageDocument(doc);

    // Indicate that we are finished.
    await doc.setFlag(MODULE_ID, FLAGS.VERSION, moduleVersion)
    return true;
  }

  static async _doTokenTransition(doc) {
    const moduleVersion = game.modules.get(MODULE_ID).version;
    const savedVersion = doc.getFlag(MODULE_ID, FLAGS.VERSION);
    if ( savedVersion && !foundry.utils.isNewerVersion(moduleVersion, savedVersion) ) return false;

    // Set the id if possible.
    const uniqueEffectId = doc.getFlag(MODULE_ID, FLAGS.UNIQUE_EFFECT.ID);
    if ( !uniqueEffectId ) {
      let effect;
      for ( effect of this._storageMap.values() ) {
        if ( effect.name === doc.name ) break;
      }
      if ( effect ) await doc.setFlag(MODULE_ID, FLAGS.UNIQUE_EFFECT.ID, effect.uniqueEffectId);
    }

    // Child transitions.
    await this._transitionTokenDocument(doc);

    // Indicate that we are finished.
    await doc.setFlag(MODULE_ID, FLAGS.VERSION, moduleVersion)
    return true;
  }


  /**
   * Transition a single document stored in the storage object
   */
  static async _transitionStorageDocument(_doc) {
  }

  /**
   * Transition a single document stored on the token.
   */
  static async _transitionTokenDocument(_doc) {
  }

  // ----- NOTE: Static multiple document handling ---- //

  /**
   * Initialize all known objects.
   * By default, all known documents and all defaults not already docs are instantiated
   */
  static async initialize() {
    this._storageMap = await this._initializeStorageMap();

    // Create unique effects from the documents held in the storage document.
    for ( const doc of this._storageMap.values() ) await this.create(doc.getFlag(MODULE_ID, FLAGS.UNIQUE_EFFECT.ID));

    // Create unique effects from default ids
    for ( const uniqueEffectId of this.defaultEffectIds() ) await this.create(uniqueEffectId);
  }

  /**
   * Initialize item used to store active effects.
   * Once created, it will be stored in the world and becomes the method by which cover effects
   * are saved.
   */
  static async _initializeStorageMap() {
     console.error("AbstractUniqueEffect._initializeStorageMap must be handled by child class");
  }

  /**
   * Delete all effects and optionally their underlying documents.
   * @param {boolean} [deleteDocument=false]  If true, delete the underlying document.
   */
  static async deleteAll(deleteDocument=false) {
    const promises = [];
    this._instances.forEach(instance => promises.push(instance.destroy(deleteDocument)));
    return Promise.allSettled(promises);
  }


  // ----- NOTE: Static default data handling ----- //

  /**
   * Search documents for all stored effects.
   * Child class may also include default effects not yet created.
   * This should not require anything to be loaded, so it can be run at canvas.init.
   * @returns {Map<string, string>} Effect id keyed to effect name
   */
  static _mapStoredEffectNames() {
    console.error("AbstractUniqueEffect._mapStoredEffectNames must be handled by child class");
  }

  /**
   * Obtain unique effect ids for all default effects that should be instantiated.
   * @returns {Set<string>}
   */
  static defaultEffectIds() { return new Set(); }


  // ---- NOTE: Static import/export ----- //

  /**
   * Save all cover objects to a json file.
   */
  static saveAllToJSON(filename) {
    filename ??= `${MODULE_ID}_AbstractTerrain`;
    const data = { objects: [], flags: {} };
    this._instances.forEach(c => data.objects.push(c.toJSON()));
    data.flags.exportSource = {
      world: game.world.id,
      system: game.system.id,
      coreVersion: game.version,
      systemVersion: game.system.version,
      [`${MODULE_ID}Version`]: game.modules.get(MODULE_ID).version
    };
    saveDataToFile(JSON.stringify(data, null, 2), "text/json", `${filename}.json`);
  }

  /**
   * Import all cover types from a json file.
   * @param {JSON} json   Data to import
   */
  static async importAllFromJSON(json) {
    json = JSON.parse(json);
    if ( !json.flags?.exportSource?.[`${MODULE_ID}Version`] ) {
      console.error("JSON file not recognized.");
      return;
    }

    // Remove all existing.
    await this.deleteAll(true);

    // Cycle through each json object in turn.
    // Create a blank object using the id from the json and then update it with the json data.
    const objects = json.objects || json.coverObjects;
    const promises = [];
    for ( const data of objects ) {
      const obj = await this.create(data.id);
      promises.push(obj.fromJSON(JSON.stringify(data)));
    }
    return Promise.allSettled(promises);
  }

  /**
   * Refresh the token display and sheet when adding a local effect.
   * @param {Token} token
   */
  static refreshTokenDisplay(token) {
    token.renderFlags.set({ redrawEffects: true });
    if ( token.actor ) {
      token.actor.reset(); // Works for items in pf2e and AE in dnd5e.
      queueSheetRefresh(token.actor);
    }
  }
}

// ----- NOTE: Helper functions ----- //


/**
 * Handle multiple sheet refreshes by using an async queue.
 * If the actor sheet is rendering, wait for it to finish.
 */
const sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay))

const renderQueue = new AsyncQueue();

const queueObjectFn = function(ms, actor) {
  return async function rerenderActorSheet() {
    log(`AbstractUniqueEffect#rerenderActorSheet|Testing sheet for ${actor.name}`);

    // Give up after too many iterations.
    const MAX_ITER = 10;
    let iter = 0;
    while ( iter < MAX_ITER && actor.sheet?._state === Application.RENDER_STATES.RENDERING ) {
      iter += 1;
      await sleep(ms);
    }
    if ( actor.sheet?.rendered ) {
      log(`AbstractUniqueEffect#rerenderActorSheet|Refreshing sheet for ${actor.name}`);
      await actor.sheet.render(true);
    }
  }
}

function queueSheetRefresh(actor) {
  log(`AbstractUniqueEffect#rerenderActorSheet|Queuing sheet refresh for ${actor.name}`);
  const queueObject = queueObjectFn(100, actor);
  renderQueue.enqueue(queueObject); // Could break up the queue per actor but probably unnecessary?
}