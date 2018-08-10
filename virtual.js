/* dBrowser Global Variables and Configuration */

const assert = require('assert')
const {VFSystemContainer} = require('./base')
const {VFSystemVault} = require('./vault')
const {diffUpdate, sortCompare} = require('./util')

class VFSystemFolder extends VFSystemContainer {
  constructor (parent) {
    super()
    this.parent = parent
    this._children = []
  }

  get type () { return 'folder' }
  get isEmpty () { return this._children.length === 0 }
  get children () { return this._children }

  async readData () {
    // fetch new children and update via diff
    var newChildren = await this.readChildren()
    this._children = diffUpdate(this._children, newChildren)
  }

  // should be overridden by subclass
  async readChildren () {
    return this._children
  }

  sort (column, dir) {
    this._children.forEach(child => child.sort(column, dir))
    this._children.sort((a, b) => {
      // by current setting
      return sortCompare(a, b, column, dir)
    })
  }
}

class VFSystemRoot extends VFSystemFolder {
  get type () { return 'root folder' }
  get url () { return 'virtual://root' }
  get name () { return 'Root' }

  async readChildren () {
    // read user profile
    const profile = await dbrowser.profiles.getCurrentUserProfile()
    profile.isCurrentUser = true

    // do not add additional child node when following self
    const followUrls = profile.followUrls ? profile.followUrls.filter((url) => url !== profile._origin) : []

    // read followed profiles
    const followedProfiles = await Promise.all(followUrls.map(dbrowser.profiles.getUserProfile))
    const followedFolders = followedProfiles.map(p => new VFSystemFolder_User(this, p))

    // generate children
    return [
      new VFSystemFolder_User(this, profile),
      new VFSystemFolder_Network(this),
      ...followedFolders,
      new VFSystemFolder_Trash(this)
    ]
  }

  sort () {
    // dont sort
  }
}

class VFSystemFolder_User extends VFSystemFolder {
  constructor (parent, profile) {
    super()
    this.parent = parent
    this._profile = profile
  }

  get name () { return this._profile.name || 'Anonymous' }
  get url () { return 'virtual://user-' + this._profile._origin }

  copyDataFrom (node) {
    this._profile = node._profile
  }

  async readChildren () {
    // read source set of vaults
    var vaults
    if (this._profile.isCurrentUser) {
      vaults = await dbrowser.vaults.list({isSaved: true, isOwner: true})
    } else {
      // fetch their published vaults
      vaults = await dbrowser.vaults.listPublished({author: this._profile._origin})
      // remove their profile vault if its in there (we want the direct source)
      vaults = vaults.filter(a => a.url !== this._profile._origin)
      // now add their profile vault to the front
      let profileVault = new DWebVault(this._profile._origin)
      let profileVaultInfo = await profileVault.getInfo()
      vaults.unshift(profileVaultInfo)
    }
    return vaults.map(a => new VFSystemVault(this, a))
  }
}

class VFSystemFolder_Network extends VFSystemFolder {
  get name () { return 'Network' }
  get url () { return 'virtual://network' }

  async readChildren () {
    const vaults = await dbrowser.vaults.list({isSaved: true, isOwner: false})
    return vaults.map(a => new VFSystemVault(this, a))
  }

  // special helper
  // this folder has vaults added arbitrarily on user access
  // so we need this method to add the vault
  addVault (vaultInfo) {
    const alreadyExists = !!this._children.find(item => item._vaultInfo.url === vaultInfo.url)
    if (!alreadyExists) {
      const vault = new VFSystemVault(this, vaultInfo)
      this._children.push(vault)
    }
  }

  sort () {
    // dont sort
  }
}

class VFSystemFolder_Trash extends VFSystemFolder {
  get name () { return 'Trash' }
  get url () { return 'virtual://trash' }

  async readChildren () {
    const vaults = await dbrowser.vaults.list({isSaved: false})
    return vaults.map(a => new VFSystemVault(this, a))
  }
}

module.exports = {
  VFSystemRoot,
  VFSystemFolder,
  VFSystemFolder_User,
  VFSystemFolder_Network,
  VFSystemFolder_Trash
}
