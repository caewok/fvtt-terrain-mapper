/* globals
CONFIG,
Hooks,
libWrapper
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "./const.js";

// Class to control patching: libWrapper, hooks, added methods.
export class Patcher {
  /**
   * @typedef {object} RegTracker
   * @property {Map<number, object[]} PATCHES   libWrapper patch ids --> arguments to libWrapper
   * @property {Map<string, object[]} METHODS   class method names --> arguments to add the method
   * @property {Map<number, object[]} HOOKS     hook number --> arguments to the hook
   * @property {function} regHook               decorated function to register hooks for the group
   * @property {function} regMethod             decorated function to register methods for the group
   * @property {function} regWrap               decorated function to register wraps for the group
   * @property {function} regOverride           decorated function to register overrides for the group
   */

  /** @type {RegTracker} */
  regTracker = {};

  /** @type {Set} */
  groupings = new Set();

  /** @type {object} */
  patches;

  constructor(patches) {
    this.patches = patches;
    this.#initializeRegistrationTracker();
  }

  groupIsRegistered(groupName) {
    const regObj = this.regTracker[groupName];
    return regObj.PATCHES.size || regObj.METHODS.size || regObj.HOOKS.size;
  }

  /**
   * Run through the patches and construct mappings for each group in the RegTracker.
   */
  #initializeRegistrationTracker() {
    // Decorate each group type and create one per option.
    this.groupings.clear();
    Object.values(this.patches).forEach(obj => Object.keys(obj).forEach(k => this.initializeGroup(k)));
  }

  /**
   * Register a specific group in the tracker.
   * @param {string} groupName
   */
  initializeGroup(groupName) {
    if ( this.groupings.has(groupName) ) return;
    this.groupings.add(groupName);
    const regObj = this.regTracker[groupName] = {};
    regObj.PATCHES = new Map();
    regObj.METHODS = new Map();
    regObj.HOOKS = new Map();
    regObj.regLibWrapper = regDec(addLibWrapperPatch, regObj.PATCHES);
    regObj.regMethod = regDec(this.constructor.addClassMethod, regObj.METHODS);
    regObj.regHook = regDec(addHook, regObj.HOOKS);
  }

  /**
   * Register all of a given group of patches.
   */
  registerGroup(groupName) {
    for ( const className of Object.keys(this.patches) ) this._registerGroupForClass(className, groupName);
  }

  /**
   * For a given group of patches, register all of them.
   */
  _registerGroupForClass(className, groupName) {
    const grp = this.patches[className][groupName];
    if ( !grp ) return;
    for ( const [key, obj] of Object.entries(grp) ) {
      const prototype = !key.includes("STATIC");
      const libWrapperType = key.includes("OVERRIDES")
        ? libWrapper.OVERRIDE : key.includes("MIXES") ? libWrapper.MIXED : libWrapper.WRAPPER;
      let getter = false;
      switch ( key ) {
        case "HOOKS":
          this._registerHooks(obj, groupName);
          break;
        case "STATIC_OVERRIDES": // eslint-disable-line no-fallthrough
        case "OVERRIDES":
        case "STATIC_MIXES":
        case "MIXES":
        case "STATIC_WRAPS":
        case "WRAPS":
          this._registerWraps(obj, groupName, className, { libWrapperType, prototype });
          break;
        case "STATIC_GETTERS":  // eslint-disable-line no-fallthrough
        case "GETTERS":
          getter = true;
        default:  // eslint-disable-line no-fallthrough
          this._registerMethods(obj, groupName, className, { prototype, getter });
      }
    }
  }

  /**
   * Register a group of methods in libWrapper.
   * @param {object|Map<string, function>} wraps      The functions to register
   * @param {string} groupName                        Group to use for the tracker
   * @param {string} className                        The class name to use; will be checked against CONFIG
   * @param {object} [opt]                            Options passed to libWrapper
   * @param {boolean} [opt.prototype]                 Whether to use class.prototype or just class
   * @param {boolean} [opt.override]                  If true, use override in libWrapper
   * @param {libWrapper.PERF_FAST|PERF_AUTO|PERF_NORMAL}
   */
  _registerWraps(wraps, groupName, className, { prototype, libWrapperType, perf_mode } = {}) {
    prototype ??= true;
    libWrapperType ??= libWrapper.WRAPPER;
    perf_mode ??= libWrapper.PERF_FAST;

    className = this.constructor.lookupByClassName(className, { returnPathString: true });
    if ( prototype ) className = `${className}.prototype`;
    for ( const [name, fn] of Object.entries(wraps) ) {
      const methodName = `${className}.${name}`;
      this.regTracker[groupName].regLibWrapper(methodName, fn, libWrapperType, { perf_mode });
    }
  }

  /**
   * Register a group of new methods.
   * @param {object|Map<string, function>} methods    The functions to register
   * @param {string} groupName                        Group to use for the tracker
   * @param {string} className                        The class name to use; will be checked against CONFIG
   * @param {object} [opt]                            Options passed to teh registration
   * @param {boolean} [opt.prototype]                 Whether to use class.prototype or just class
   * @param {boolean} [opt.getter]                    If true, register as a getter
   */
  _registerMethods(methods, groupName, className, { prototype = true, getter = false } = {}) {
    let cl = this.constructor.lookupByClassName(className);
    if ( prototype ) cl = cl.prototype;
    for ( const [name, fn] of Object.entries(methods) ) {
      this.regTracker[groupName].regMethod(cl, name, fn, { getter });
    }
  }

  /**
   * Register a group of hooks.
   * @param {object|Map<string, function>} methods    The hooks to register
   * @param {string} groupName                        Group to use for the tracker
   */
  _registerHooks(hooks, groupName) {
    for ( const [name, fn] of Object.entries(hooks) ) {
      this.regTracker[groupName].regHook(name, fn);
    }
  }

  /**
   * Deregister an entire group of patches.
   * @param {string} groupName    Name of the group to deregister.
   */
  deregisterGroup(groupName) {
    const regObj = this.regTracker[groupName];
    this.#deregisterPatches(regObj.PATCHES);
    this.#deregisterMethods(regObj.METHODS);
    this.#deregisterHooks(regObj.HOOKS);
  }

  /**
   * Deregister all libWrapper patches in this map.
   */
  #deregisterPatches(map) {
    map.forEach((_args, id) => libWrapper.unregister(MODULE_ID, id, false));
    map.clear();
  }

  /**
   * Deregister all hooks in this map.
   */
  #deregisterHooks(map) {
    map.forEach((hookName, id) => Hooks.off(hookName, id));
    map.clear();
  }

  /**
   * Deregister all methods in this map.
   */
  #deregisterMethods(map) {
    map.forEach((args, _id) => {
      const { cl, name } = args;
      delete cl[name];
    });
    map.clear();
  }

  /**
   * Add a method or a getter to a class.
   * @param {class} cl      Either Class.prototype or Class
   * @param {string} name   Name of the method
   * @param {function} fn   Function to use for the method
   * @param {object} [opts] Optional parameters
   * @param {boolean} [opts.getter]     True if the property should be made a getter.
   * @param {boolean} [opts.optional]   True if the getter should not be set if it already exists.
   * @returns {undefined|object<id{string}} Either undefined if the getter already exists or the cl.prototype.name.
   */
  static addClassMethod(cl, name, fn, { getter = false, optional = false } = {}) {
    if ( optional && Object.hasOwn(cl, name) ) return undefined;
    const descriptor = { configurable: true };
    if ( getter ) descriptor.get = fn;
    else {
      descriptor.writable = true;
      descriptor.value = fn;
    }
    Object.defineProperty(cl, name, descriptor);

    const prototypeName = cl.constructor?.name;
    const id = `${prototypeName ?? cl.name }.${prototypeName ? "prototype." : ""}${name}`; // eslint-disable-line template-curly-spacing
    return { id, args: { cl, name } };
  }

  /**
   * A thorough lookup method to locate Foundry classes by name.
   * Relies on CONFIG where possible, falling back on eval otherwise.
   * @param {string} className
   * @param {object} [opts]
   * @param {boolean} [opts.returnPathString]   Return a string path to the object, for libWrapper.
   * @returns {class}
   */
  static lookupByClassName(className, { returnPathString = false } = {}) {
    let isDoc = className.endsWith("Document");
    let isConfig = className.endsWith("Config");
    let baseClass = isDoc ? className.replace("Document", "") : isConfig ? className.replace("Config", "") : className;

    const configObj = CONFIG[baseClass];
    if ( !configObj || isConfig ) return returnPathString ? className : eval?.(`"use strict";(${className})`);

    // Do this the hard way to catch inconsistencies
    switch ( className ) {
      case "Actor":
      case "ActiveEffect":
      case "Item":
        isDoc = true; break;
    }

    if ( isDoc && configObj.documentClass ) {
      return returnPathString ? `CONFIG.${baseClass}.documentClass` : configObj.documentClass;
    }

    if ( configObj.objectClass ) return returnPathString ? `CONFIG.${baseClass}.objectClass` : configObj.objectClass;
    return returnPathString ? className : eval?.(`"use strict";(${className})`);
  }

}

// ----- NOTE: Helper functions ----- //

/**
 * Helper to wrap/mix/override methods.
 * @param {string} method       Method to wrap
 * @param {function} fn         Function to use for the wrap
 * @param {libWrapper.TYPES}    libWrapper.WRAPPED, MIXED, OVERRIDE
 * @param {object} [options]    Options passed to libWrapper.register. E.g., { perf_mode: libWrapper.PERF_FAST}
 * @returns {object<id{number}, args{string}} libWrapper ID and the method used
 */
function addLibWrapperPatch(method, fn, libWrapperType, options) {
  const id = libWrapper.register(MODULE_ID, method, fn, libWrapperType, options);
  return { id, args: method };
}

/**
 * Wrapper to add a hook, b/c calling Hooks.on directly with a decorator does not work.
 * @param {string} hookName     Name of the hook
 * @param {function} fn         Function to use for the hook
 * @returns {object<id{number}, args{string}} hook id and the hook name
 */
function addHook(hookName, hookFn) {
  const id = Hooks.on(hookName, hookFn);
  return { id, args: hookName };
}

/**
 * Decorator to register and record a patch, method, or hook.
 * @param {function} fn   A registration function that returns an id. E.g., libWrapper or Hooks.on.
 * @param {Map} map       The map in which to store the id along with the arguments used when registering.
 * @returns {number} The id
 */
function regDec(fn, map) {
  return function() {
    const { id, args } = fn.apply(this, arguments);
    map.set(id, args);
    return id;
  };
}
