/* globals
foundry,
game,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, FA_ICONS } from "./const.js";
import { TerrainEffectsControllerV2 } from "./TerrainEffectsControllerV2.js";
import { Settings } from "./settings.js";

// See
// https://github.com/DFreds/dfreds-convenient-effects/blob/main/src/ts/ui/ce-app/convenient-effects-v2.ts

/**
 * Application class for handling the UI of the terrain effects.
 * Based on AbstractSidebarTab.
 */
export class TerrainEffectsAppV2 extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.sidebar.AbstractSidebarTab) {

  /**
   * Re-render if the app is open.
   * Needed when terrain effects are updated in the effects app.
   * See https://github.com/DFreds/dfreds-convenient-effects/blob/c2d5e81eb1d28d4db3cb0889c22a775c765c24e3/scripts/foundry-helpers.js#L51
   */
  static rerender() {
    const app = ui.sidebar.popouts[MODULE_ID];
    if ( app ) app.render(true);
  }

  /**
   * Initializes the application and its dependencies
   */
  constructor() {
    super();
    this._controller = new TerrainEffectsControllerV2(this);
  }

  static tabName = MODULE_ID;

  static DEFAULT_OPTIONS = {
//     width: 300,
//     height: 600,
//     top: 60,
//     left: 100,
    classes: ["directory", "flexcol"],
    window: {
      title: `${MODULE_ID}.phrases.terrains`,
      icon: FA_ICONS.TERRAIN_BOOK,
      frame: true, // If true, will be popout.
      positioned: true,
    },
    resizable: true,
    template: `modules/${MODULE_ID}/templates/terrain-effects-menu-app.html`,
    position: {
      top: 60,
      left: 100,
      width: 300,
      height: 600,
    },
    dragDrop: [
      {
        dragSelector: ".terrainmapper"
      }
    ],
    filters: [
      {
        inputSelector: 'input[name="search"]',
        contentSelector: ".directory-list"
      }
    ],
    actions: {
      createEffect: TerrainEffectsAppV2.#onCreateEffect,
      createEffectInFolder: TerrainEffectsAppV2.#onCreateEffectInFolder,
      createFolder: TerrainEffectsAppV2.#onCreateFolder,
      collapseFolders: TerrainEffectsAppV2.#onCollapseFolders,
      toggleFolder: TerrainEffectsAppV2.#onToggleFolder,
      resetDefaults: TerrainEffectsAppV2.#onResetDefaults,
    },
  };

  static _entryPartial = `modules/${MODULE_ID}/templates/terrain-effects-menu-app-document-partial.html`;

  static _folderPartial = `modules/${MODULE_ID}/templates/terrain-effects-menu-app-folder-partial.html`;

  static PARTS = {
    header: {
      template: `modules/${MODULE_ID}/templates/terrain-effects-menu-app-header.html`,
    },
    directory: {
      template: `modules/${MODULE_ID}/templates/terrain-effects-menu-app-directory.html`,
      templates: [
        this._folderPartial,
        this._entryPartial,
      ],
      scrollable: [""],
    },
  };

  /**
   * Add context menus at first render.
   *
   * -----
   * Actions performed after a first render of the Application.
   * @param {ApplicationRenderContext} context      Prepared context data
   * @param {RenderOptions} options                 Provided render options
   * @returns {Promise<void>}
   */
  async _onFirstRender(context, options) {
   await super._onFirstRender(context, options);
   this._createContextMenus();
  }

  /**
   * Add search, drag-drop functionality, and folder expansion.
   *
   * ----
   * Actions performed after any render of the Application.
   * @param {ApplicationRenderContext} context      Prepared context data
   * @param {RenderOptions} options                 Provided render options
   * @returns {Promise<void>}
   */
  async _onRender(context, options) {
    await super._onRender(context, options);

    // Search.
    if ( options.parts?.includes("header") ) {
      new foundry.applications.ux.SearchFilter({
          inputSelector: "search input",
          contentSelector: ".directory-list",
          callback: this._controller._onSearchFilter.bind(this._controller),
          initial: (this.element.querySelector("search input")).value,
      }).bind(this.element);
    }

    // Drag-drop.
    if ( options.parts?.includes("directory") ) {
      new foundry.applications.ux.DragDrop.implementation({
        dragSelector: ".directory-item",
        dropSelector: ".directory-list",
        permissions: {
          dragstart: this._controller.canDragStart,
          drop: this._controller.canDragDrop,
        },
        callbacks: {
          dragstart: this._controller.onDragStart,
          dragover: this._controller.onDragOver,
          drop: this._controller.onEffectDrop,
        },
      }).bind(this.element);
    }

    // Expand folders.
    if ( options.parts?.includes("directory") ) {
       Settings.expandedFolders.forEach(folderId => {
         const folderHTML = this.element.querySelector(`[data-folder-id='${folderId}']`);
         if ( folderHTML ) folderHTML.classList.add("expanded");
       });
    }
  }

  _createContextMenus() {
    this._createContextMenu(
      this._getFolderContextOptions,
      ".folder .folder-header",
      {
        fixed: true,
      },
    );
    this._createContextMenu(
      this._getTerrainEntryContextOptions,
      ".directory-item[data-entry-id]",
      {
        fixed: true,
      },
    );
  }

  _getFolderContextOptions() {
    return [
      {
        name: "FOLDER.Edit",
        icon: '<i class="fa-solid fa-pen-to-square"></i>',
        condition: header => {
          const folderId = this.#folderIdFromElement(header);
          return TerrainEffectsControllerV2.canModifyFolder(folderId);
        },
        callback: async li => {
          const folderId = this.#folderIdFromElement(li);
          return this._controller.onEditFolder(folderId);
        },
      },
      {
        name: "FOLDER.Remove",
        icon: '<i class="fa-solid fa-dumpster"></i>',
        condition: header => {
          const folderId = this.#folderIdFromElement(header);
          return TerrainEffectsControllerV2.canModifyFolder(folderId);
        },
        callback: async li => {
          const folderId = this.#folderIdFromElement(li);
          return this._controller.onDeleteFolder(folderId);
        },
      },
    ];
  }

  _getTerrainEntryContextOptions() {
    return [
      {
        name: `${MODULE_ID}.terrainbook.edit-terrain`,
        icon: '<i class="fas fa-edit fa-fw"></i>',
        condition: () => game.user.isGM,
        callback: async li => {
          const effectId = this.#effectIdFromElement(li);
          return this._controller.onEditTerrain(effectId);
        }
      },
      {
        name: "SIDEBAR.Duplicate",
        icon: '<i class="far fa-copy fa-fw"></i>',
        condition: () => game.user.isGM,
        callback: async li => {
          const effectId = this.#effectIdFromElement(li);
          return this._controller.onDuplicateTerrain(effectId);
        }
      },
      {
        name: `${MODULE_ID}.terrainbook.add-favorite`,
        icon: '<i class="fas fa-star fa-fw"></i>',
        condition: effectItem => {
          return !this._controller.isFavorited(effectItem);
        },
        callback: async li => {
          const effectId = this.#effectIdFromElement(li);
          return this._controller.onAddFavorite(effectId);
        },
      },
      {
        name: `${MODULE_ID}.terrainbook.remove-favorite`,
        icon: '<i class="far fa-star fa-fw"></i>',
        condition: effectItem => {
          return this._controller.isFavorited(effectItem);
        },
        callback: async li => {
          const effectId = this.#effectIdFromElement(li);
          return this._controller.onRemoveFavorite(effectId);
        },
      },
      {
        name: `${MODULE_ID}.terrainbook.import-terrain`,
        icon: '<i class="far fa-file-arrow-up"></i>',
        condition: () => game.user.isGM,
        callback: async li => {
          const effectId = this.#effectIdFromElement(li);
          return this._controller.onImportTerrain(effectId);
        },
      },
      {
        name: `${MODULE_ID}.terrainbook.export-terrain`,
        icon: '<i class="far fa-file-arrow-down"></i>',
        condition: () => game.user.isGM,
        callback: async li => {
          const effectId = this.#effectIdFromElement(li);
          return this._controller.onExportTerrain(effectId);
        },
      },
      {
        name: `${MODULE_ID}.terrainbook.delete-terrain`,
        icon: '<i class="fas fa-trash fa-fw"></i>',
        condition: () => game.user.isGM,
        callback: async li => {
          const effectId = this.#effectIdFromElement(li);
          return this._controller.onDeleteTerrain(effectId);
        },
      }
    ];
  }

  #folderIdFromElement(li) {
    const folderHTML = li.closest(".directory-item.folder");
    return folderHTML.dataset.folderId;
  }

  #effectIdFromElement(li) {
    const effectHTML = li.closest("[data-entry-id]");
    return effectHTML.dataset.entryId;
  }

  /**
   * Data for the terrain sidebar.
   *
   * -----
   * Prepare application rendering context data for a given render request. If exactly one tab group is configured for
   * this application, it will be prepared automatically.
   * @param {RenderOptions} options                 Options which configure application rendering behavior
   * @returns {Promise<ApplicationRenderContext>}   Context data for the render operation
   */
  // async _prepareContext(options)

  /**
   * Prepare context specific to the header and the folder directory parts.
   *
   * -----
   * @param {string} partId                         The part being rendered
   * @param {ApplicationRenderContext} context      Shared context provided by _prepareContext
   * @param {HandlebarsRenderOptions} options       Options which configure application rendering behavior
   * @returns {Promise<ApplicationRenderContext>}   Context data for a specific part
   */
  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    switch ( partId ) {
      case "directory": this._controller.directoryData(context); break;
      case "header": this._controller.headerData(context); break;
    }
    return context;
  }

  /**
   * Keep search state synced.
   *
   * -----
   * Prepare data used to synchronize the state of a template part.
   * @param {string} partId                       The id of the part being rendered
   * @param {HTMLElement} newElement              The new rendered HTML element for the part
   * @param {HTMLElement} priorElement            The prior rendered HTML element for the part
   * @param {object} state                        A state object which is used to synchronize after replacement
   */
  _preSyncPartState(partId, newElement, priorElement, state) {
    super._preSyncPartState(partId, newElement, priorElement, state);
    if ( partId === "header" ) {
      const searchInput = priorElement.querySelector("search input");
      if ( searchInput ) state.query = searchInput.value;
    }
  }

  /**
   * Keep search state synced.
   *
   * ----
   * @param {string} partId                       The id of the part being rendered
   * @param {HTMLElement} newElement              The new rendered HTML element for the part
   * @param {HTMLElement} priorElement            The prior rendered HTML element for the part
   * @param {object} state                        A state object which is used to synchronize after replacement
   */
  _syncPartState(partId, newElement, priorElement, state) {
    super._syncPartState(partId, newElement, priorElement, state);
    if ( partId === "header" && state.query ) {
      const searchInput = newElement.querySelector("search input");
      if ( searchInput ) searchInput.value = state.query;
    }
  }

  async collapseAllFolders() {
    for (const el of this.element.querySelectorAll(".directory-item.folder")) el.classList.remove("expanded");
    await Settings.clearExpandedFolders();
  }

  /**
   * @param {string} folderId
   */
  async toggleFolder(folderId) {
    if ( Settings.isFolderExpanded(folderId) ) await Settings.removeExpandedFolder(folderId);
    else await Settings.addExpandedFolder(folderId);
    if ( this.isPopout ) this.setPosition();
  }

  static async #onCreateEffect(event, _target) {
    event.stopPropagation();
    return this._controller.onCreateTerrain();
  }

  static async #onCreateEffectInFolder(event, target) {
    event.stopPropagation();
    const folderId = this.#folderIdFromElement(target);
    return this._controller.onCreateTerrain(folderId);
  }

  static async #onCreateFolder(event, _target) {
    event.stopPropagation();
    return this._controller.onCreateFolder();
  }

  static async #onCollapseFolders(event, _target) {
    event.stopPropagation();
    return this.collapseAllFolders();
  }

  static async #onToggleFolder(event, target) {
    event.stopPropagation();
    const folderHTML = target.closest(".directory-item.folder");
    folderHTML.classList.toggle("expanded");
    const folderId = folderHTML.dataset.folderId;
    if ( !folderId ) return;
    return this.toggleFolder(folderId);
  }

  static async #onResetDefaults(event, _target) {
    event.stopPropagation();
    return this._controller.onCreateDefaults();
  }

}
