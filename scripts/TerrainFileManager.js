/* globals
canvas,
CONFIG,
FilePicker,
game,
PIXI,
readTextFromFile,
saveDataToFile,
TextureLoader
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, SOCKETS } from "./const.js";
import { log } from "./util.js";

// Class to manage loading and saving of the terrain texture.

export class TerrainFileManager {
  /**
   * The maximum allowable visibility texture size.
   * In v11, this is equal to CanvasVisibility.#MAXIMUM_VISIBILITY_TEXTURE_SIZE
   * @type {number}
   */
  static #MAXIMUM_TEXTURE_SIZE = CONFIG[MODULE_ID]?.elevationTextureSize ?? 4096;

  /** @type {boolean} */
  #initialized = false;

  /** @type {boolean} */
  #useCachedTexture = false;

  /** @type {string} */
  #filePath = "";

  /** @type {string} */
  #textureFileName = "";

  /** @type {string} */
  #dataFileName = "";

  /**
   * @typedef {object} ElevationTextureConfiguration
   * @property {number} resolution    Resolution of the texture
   * @property {number} width         Width, based on sceneWidth
   * @property {number} height        Height, based on sceneHeight
   * @property {PIXI.MIPMAP_MODES} mipmap
   * @property {PIXI.SCALE_MODES} scaleMode
   * @property {PIXI.MSAA_QUALITY} multisample
   * @property {PIXI.FORMATS} format
   */

  /** @type {ElevationTextureConfiguration} */
  #textureConfiguration;

  /**
   * Initialize the terrain texture - resetting it when switching scenes or redrawing canvas.
   * @returns {Promise<void>}
   */
  async initialize() {
    this.#initialized = false;
    this.#textureConfiguration = undefined;

    // Set the file path and ensure that the folder structure is present
    const filePath = `worlds/${game.world.id}/assets/${MODULE_ID}`;
    this.#filePath = await this.constructor.constructSaveDirectory(filePath);
    this.#textureFileName = `${game.world.id}-${canvas.scene.id}-terrainMap`;
    this.#dataFileName = `${game.world.id}-${canvas.scene.id}-terrainData`;
    this.#initialized = true;
  }

  get textureConfiguration() {
    return this.#textureConfiguration ?? (this.#textureConfiguration = this._textureConfiguration());
  }

  /**
   * Load the terrain data from the stored file for the world and scene.
   *

  /**
   * Load the terrain texture from the stored file for the world and scene.
   * @returns {PIXI.Texture}
   */
  async loadTexture() {
    let filePath = `${this.#filePath}/${this.#textureFileName}.webp`;

    // Bust the caching of the texture (The Forge issue).
    if ( filePath.startsWith("https://")
      || filePath.startsWith("http://") ) filePath = `${filePath}?v=${Math.random()}`;

    log(`Loading ${filePath}`);
    try {
      const baseTexture = await TextureLoader.loader.loadTexture(filePath);
      const texture = new PIXI.Texture(baseTexture);
      return this._formatTexture(texture);
    } catch(err) {
      console.warn("TerrainMapper|TerrainFileManager load threw error", err);
      return undefined; // May or may not be an error depending on whether texture should be there.
    }
  }

  /**
   * Import elevation data from the provided image file location into a texture
   * @param {File} file
   * @returns {PIXI.Texture}
   */
  async loadTextureFromFile(file) {
    log("Loading from file");
    try {
      const texture = await PIXI.Texture.fromURL(file);
      return this._formatTexture(texture);

    } catch(err) {
      console.error("TerrainMapper|loadFromFile encountered error", err, file);
      return undefined;
    }
  }

  /**
   * Format a texture for use as an terrain texture.
   * @param {PIXI.Texture}
   * @returns {PIXI.Texture}
   */
  _formatTexture(texture) {
    const { width, height } = canvas.dimensions.sceneRect;
    const resolution = texture.width > texture.height ? texture.width / width : texture.height / height;
    texture.baseTexture.setSize(width, height, resolution);
    texture.baseTexture.setStyle(this.textureConfiguration.scaleMode, this.textureConfiguration.mipmap);
    return texture;
  }

  /**
   * Confirm if a hierarchy of directories exist within the "data" storage location.
   * Create new directories if missing.
   * @param {string} filePath   The directory path, separated by "/".
   * @returns {string} The constructed storage path, not including "data".
   */
  static async constructSaveDirectory(filePath) {
    const dirs = filePath.split("/");
    const res = await SOCKETS.socket.executeAsGM("buildDirPath", dirs);
    if ( !res ) { console.error(`Error constructing the file path ${filePath}.`); }
    return filePath;
  }

  /**
   * Save the provided texture to the location in "data" provided in the initialization step.
   * Default location is data/worlds/world-id/assets/elevatedvision/
   * @param {PIXI.Texture} texture      Texture to save as the elevation map
   * @returns {Promise<object>}  The response object from FilePicker.upload.
   */
  async saveTexture(texture) {
    log(`Saving texture to ${this.#filePath}/${this.#textureFileName}.webp`);
    const base64image = await this.convertTextureToImage(texture);
    return this.constructor.uploadBase64(base64image, `${this.#textureFileName}.webp`, this.#filePath, { type: "image", notify: false });
  }

  /**
   * Load a json file with terrain data.
   * @returns {object|undefined} The data object unless an error occurs or file does not exist, then undefined.
   */
  async loadData() {
    if ( !(await doesFileExist(this.#filePath, `${this.#dataFileName}.json`)) ) return undefined;

    const filePath = `${this.#filePath}/${this.#dataFileName}.json`;
    let data;
    try {
      data = await foundry.utils.fetchJsonWithTimeout(foundry.utils.getRoute(filePath, {prefix: ROUTE_PREFIX}));
    } catch (err) {
      return undefined;
    }
    return data;
  }

  /**
   * Save a json file with data to the world scene folder.
   */
  async saveData(json) {
    json = JSON.stringify(json, null, 2);
    const fileName = `${this.#dataFileName}.json`;
    const type = "text/json";
    const blob = new Blob([json], { type });
    const file = new File([blob], fileName, { type });
    return FilePicker.upload("data", this.#filePath, file, {}, { notify: false });
  }

  /**
   * Like ImageHelper.uploadBase64, but passes notify through to FilePicker.upload.
   * Upload a base64 image string to a persisted data storage location
   * @param {string} base64       The base64 string
   * @param {string} fileName     The file name to upload
   * @param {string} filePath     The file path where the file should be uploaded
   * @param {object} [options]    Additional options which affect uploading
   * @param {string} [options.storage=data]   The data storage location to which the file should be uploaded
   * @param {string} [options.type]           The MIME type of the file being uploaded
   * @returns {Promise<object>}   A promise which resolves to the FilePicker upload response
   */
  static async uploadBase64(base64, fileName, filePath, { storage="data", type, notify = true }={}) {
    type ||= base64.split(";")[0].split("data:")[1];
    const blob = await fetch(base64).then(r => r.blob());
    const file = new File([blob], fileName, {type});
    return FilePicker.upload(storage, filePath, file, {}, { notify });
  }

  /**
   * Convert a texture to a specific image format for saving.
   * @param {PIXI.Texture} texture    Texture from which to pull data
   * @param {object} [opts]           Options that affect the image format returned
   * @param {string} [opts.format]    MIME type image format
   * @param {number} [opts.quality]   Quality, used for some formats such as jpeg.
   * @returns {string}
   */
  async convertTextureToImage(texture, { type = "image/webp", quality = 1 } = {}) {
    return canvas.app.renderer.plugins.extractAsync.base64(texture, type, quality);
  }

  /**
   * @typedef {object} TextureConfiguration
   * @property {number} resolution    Resolution of the texture
   * @property {number} width         Width, based on sceneWidth
   * @property {number} height        Height, based on sceneHeight
   * @property {PIXI.MIPMAP_MODES} mipmap
   * @property {PIXI.SCALE_MODES} scaleMode
   * @property {PIXI.MSAA_QUALITY} multisample
   * @property {PIXI.FORMATS} format
   */

  /**
   * Values used when rendering elevation data to a texture representing the scene canvas.
   * It may be important that width/height of the terrain texture is evenly divisible
   * by the downscaling resolution. (It is important for fog manager to prevent drift.)
   * @returns {TextureConfiguration}
   */
  _textureConfiguration() {
    // In v11, see CanvasVisibility.prototype.#configureVisibilityTexture
    const dims = canvas.scene.dimensions;
    let width = dims.sceneWidth;
    let height = dims.sceneHeight;

    let resolution = Math.clamped(CONFIG[MODULE_ID]?.resolution ?? 0.25, .01, 1);
    const maxSize = Math.min(
      this.constructor.#MAXIMUM_TEXTURE_SIZE,
      resolution * Math.max(width, height));

    if ( width >= height ) {
      resolution = maxSize / width;
      height = Math.ceil(height * resolution) / resolution;
    } else {
      resolution = maxSize / height;
      width = Math.ceil(width * resolution) / resolution;
    }

    return {
      resolution,
      width,
      height,
      mipmap: PIXI.MIPMAP_MODES.OFF,
      scaleMode: PIXI.SCALE_MODES.NEAREST,
      multisample: PIXI.MSAA_QUALITY.NONE,
      format: PIXI.FORMATS.RGB,
      type: PIXI.TYPES.UNSIGNED_BYTE
    };
  }
}


/**
 * Determine if a file exists in a folder structure using FilePicker
 * @param {string[]} dirs     Array of folder names, representing a folder hierarchy
 * @param {string} fileName   Name of file to locate
 * @returns {boolean} True if file exists
 */
export async function doesFileExist(dirPath, fileName) {
  let res;
  try {
    res = await FilePicker.browse("data", dirPath);
  } catch(error) {
    return false;
  }
  const path = `${dirPath}/${fileName}`;
  return res?.files.some(str => str === path)
}

/**
 * Recursively construct a directory path from an array of folders.
 * Based in the "data" path.
 * @param {string[]} dirs   Array of folder names, representing a folder hierarchy
 * @param {number} [idx]    Used internally to control the recursion through the folders
 * @returns {boolean} True if successful or path already exists.
 */
export async function buildDirPath(dirs, idx = dirs.length) {
  // Need to build the folder structure in steps or it will error out.
  // Browse is more expensive than createDirectory.

  // FilePicker.createDirectory has three basic returns:
  // 1. EEXIST: file already exists if the directory path is present
  // 2. ENOENT: no such file or directory if part of the directory path is not present
  // 3. the file path if the base path exists and the folder is created.
  if ( !idx ) return false;
  if ( idx > dirs.length ) return true;

  const path = dirs.slice(0, idx).join("/");
  const res = await FilePicker.createDirectory("data", path).catch(err => { return err; });

  // For The Forge, FilePicker.createDirectory may return undefined if nothing was created.
  if ( res && res.message ) {
    // If this path exists, we can move down in the folder hierarchy
    if ( res.message.includes("EEXIST: file already exists") ) return buildDirPath(dirs, idx + 1);

    // Something in the path is missing; move up in the folder hierarchy to find and create it.
    return buildDirPath(dirs, idx - 1);
  } else {
    // Folder at end of path was created. Either we are done or we need to move down the hierarchy.
    if ( idx === dirs.length ) return true;
    return buildDirPath(dirs, idx + 1);
  }
  return true; // eslint-disable-line no-unreachable
}
