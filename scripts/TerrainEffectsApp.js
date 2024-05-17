/* globals
Application,
ContextMenu,
foundry,
game,
ui
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "./const.js";
import { TerrainEffectsController } from "./TerrainEffectsController.js";


// Much of this comes from
// https://github.com/DFreds/dfreds-convenient-effects/blob/main/scripts/app/convenient-effects-app.js

/**
 * Application class for handling the UI of the terrain effects.
 */
export class TerrainEffectsApp extends Application {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      width: 300,
      height: 600,
      top: 60,
      left: 100,
      popOut: true,
      minimizable: true,
      resizable: true,
      id: "terrainmapper",
      classes: ["sidebar-popout"],
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
      title: "Terrains",
      template:
        `modules/${MODULE_ID}/templates/terrain-effects-menu-app.html`,
      scrollY: ["ol.directory-list"]
    });
  }

  /**
   * Re-render if the app is open.
   * Needed when terrain effects are updated in the effects app.
   * See https://github.com/DFreds/dfreds-convenient-effects/blob/c2d5e81eb1d28d4db3cb0889c22a775c765c24e3/scripts/foundry-helpers.js#L51
   */
  static rerender() {
    const openApps = Object.values(ui.windows);
    const app = openApps.find(app => app instanceof TerrainEffectsApp);
    if ( app ) app.render(true);
  }

  /**
   * Initializes the application and its dependencies
   */
  constructor() {
    super();
    this._controller = new TerrainEffectsController(this);
  }

  /** @override */
  getData() {
    return this._controller.data;
  }

  /** @override */
  activateListeners(html) {
    this._rootView = html;

    this._initClickListeners();
    this._initContextMenus();

    this._controller.expandSavedFolders();
  }

  /** @override */
  _onSearchFilter(event, query, regex, html) {
    this._controller.onSearchTextChange(event, query, regex, html);
  }

  /** @override */
  _onDragStart(event) {
    this._controller.onEffectDragStart(event);
  }

  /** @override */
  _canDragStart(_selector) {
    return this._controller.canDragStart();
  }

  /**
   * Checks if the folder is collapsed
   *
   * @param {string} folderId - the folder ID to check
   * @returns {boolean} true if the folder is collapsed, false otherwise
   */
  isFolderCollapsed(folderId) {
    return this._getFolderById(folderId).hasClass("collapsed");
  }

  /**
   * Collapses a folder by adding the "collapsed" CSS class to it
   *
   * @param {string} folderId - the folder ID to collapse
   */
  collapseFolder(folderId) {
    this._getFolderById(folderId).addClass("collapsed");
  }

  /**
   * Expands a folder by removing the "collapsed" CSS class from it
   *
   * @param {string} folderId - the folder ID to expand
   */
  expandFolder(folderId) {
    this._getFolderById(folderId).removeClass("collapsed");
  }

  /**
   * Collapse all folders by adding the "collapsed" CSS class to them
   */
  collapseAllFolders() {
    this._allDirectories.addClass("collapsed");
  }

  /**
   * Indicate to the user that a reload is required to update status effects
   */
  showReloadRequired() {
    ui.notifications.warn("Foundry must be reloaded to update token status effects.");
  }

  _getFolderById(folderId) {
    return this._rootView.find(`.folder[data-folder-id="${folderId}"]`);
  }

  _initClickListeners() {
    this._collapseAllButton.on(
      "click",
      this._controller.onCollapseAllClick.bind(this._controller)
    );
    this._createEffectButton.on(
      "click",
      this._controller.onCreateEffectClick.bind(this._controller)
    );
    this._effectListItems.on(
      "click",
      this._controller.onEffectClick.bind(this._controller)
    );

    this._editSceneTerrainsButton.on(
      "click",
      this._controller.onEditSceneTerrains.bind(this._controller)
    );

    this._listTerrainsButton.on(
      "click",
      this._controller.onListTerrains.bind(this._controller)
    );

    this._folderHeaders.on(
      "click",
      this._controller.onFolderClick.bind(this._controller)
    );

    this._resetStatusEffectsButton.on(
      "click",
      this._controller.onResetStatusEffectsClick.bind(this._controller)
    );
  }

  _initContextMenus() {
    new ContextMenu(this._rootView, ".terrainmapper-effect", [
      {
        name: "Edit Terrain",
        icon: '<i class="fas fa-edit fa-fw"></i>',
        condition: () => game.user.isGM,
        callback: this._controller.onEditEffectClick.bind(this._controller)
      },
      {
        name: "Duplicate",
        icon: '<i class="far fa-copy fa-fw"></i>',
        condition: () => game.user.isGM,
        callback: this._controller.onDuplicate.bind(this._controller)
      },

      {
        name: "Add Favorite",
        icon: '<i class="fas fa-star fa-fw"></i>',
        condition: effectItem => {
          return !this._controller.isFavoritedEffect(effectItem);
        },
        callback: this._controller.onAddFavorite.bind(this._controller)
      },
      {
        name: "Remove Favorite",
        icon: '<i class="far fa-star fa-fw"></i>',
        condition: effectItem => {
          return this._controller.isFavoritedEffect(effectItem);
        },
        callback: this._controller.onRemoveFavorite.bind(this._controller)
      },

      {
        name: "Import Terrain",
        icon: '<i class="far fa-file-arrow-up"></i>',
        condition: () => game.user.isGM,
        callback: this._controller.onImportTerrain.bind(this._controller)
      },

      {
        name: "Export Terrain",
        icon: '<i class="far fa-file-arrow-down"></i>',
        condition: () => game.user.isGM,
        callback: this._controller.onExportTerrain.bind(this._controller)
      },

      {
        name: "Delete Terrain",
        icon: '<i class="fas fa-trash fa-fw"></i>',
        condition: () => game.user.isGM,
        callback: this._controller.onDeleteEffectClick.bind(this._controller)
      }
    ]);
  }

  get _allDirectories() {
    return this._rootView.find(".folder");
  }

  get _createEffectButton() {
    return this._rootView.find(".create-effect");
  }

  get _collapseAllButton() {
    return this._rootView.find(".collapse-all");
  }

  get _effectListItems() {
    return this._rootView.find(".terrainmapper-effect");
  }

  get _editSceneTerrainsButton() {
    return this._rootView.find(".edit-scene-terrains");
  }

  get _listTerrainsButton() {
    return this._rootView.find(".list-terrains");
  }

  get _folderHeaders() {
    return this._rootView.find(".directory-list .folder-header");
  }

  get _resetStatusEffectsButton() {
    return this._rootView.find(".reset-status-effects");
  }

}
