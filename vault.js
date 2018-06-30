/* globals DPackVault */

const {VFSNode, VFSystemContainer} = require('./base')
const {diffUpdate, sortCompare} = require('./util')
const TEXTUAL_FILE_FORMATS = require('text-extensions')
TEXTUAL_FILE_FORMATS.push('dpackignore')

const STANDARD_VAULT_TYPES = [
  'application',
  'module',
  'dataset',
  'documents',
  'music',
  'photos',
  'user-profile',
  'videos',
  'website'
]

class VFSystemVaultContainer extends VFSystemContainer {
  constructor (parent, vault = null, vaultInfo = null) {
    super()
    this.parent = parent
    this._vault = vault
    this._vaultInfo = vaultInfo
    this._path = ''
    this._files = []
  }

  get isEmpty () { return this._files.length === 0 }
  get children () { return this._files }
  get isEditable () { return this._vaultInfo.isOwner }

  async readData () {
    // load all children
    this._vault = this._vault || new DPackVault(this._vaultInfo.url)
    var fileInfos = await this._vault.readdir(this._path, {stat: true})
    var newFiles = fileInfos.map(fileInfo => {
      const path = this._path + '/' + fileInfo.name
      if (fileInfo.stat.isDirectory()) {
        return new VFSystemVaultFolder(this, this._vault, this._vaultInfo, fileInfo.name, path, fileInfo.stat)
      }
      return new VFSystemVaultFile(this, this._vault, this._vaultInfo, fileInfo.name, path, fileInfo.stat)
    })
    this._files = diffUpdate(this._files, newFiles)
  }

  sort (column, dir) {
    this._files.forEach(file => file.sort(column, dir))
    this._files.sort((a, b) => {
      // directories at top
      if (a.isContainer && !b.isContainer) { return -1 }
      if (!a.isContainer && b.isContainer) { return 1 }
      // by current setting
      return sortCompare(a, b, column, dir)
    })
  }

  copyDataFrom (node) {
    this._vaultInfo = node._vaultInfo
    this._vault = node._vault
    this._path = node._path
  }
}

class VFSystemVault extends VFSystemVaultContainer {
  get url () { return this._vaultInfo.url }
  get type () {
    let type = this._vaultInfo && this._vaultInfo.type
    if (!type || !type.length) return 'vault'
    type = type.filter(f => STANDARD_VAULT_TYPES.includes(f))
    return type[0] || 'vault'
  }
  get name () { return (this._vaultInfo.title || '').trim() || 'Untitled' }
  get size () { return this._vaultInfo.size }
  get mtime () { return this._vaultInfo.mtime }

  async copy (newPath, targetVaultKey) {
    this._vault = this._vault || new DPackVault(this._vaultInfo.key)
    if (this._vaultInfo.key === targetVaultKey) {
      await this._vault.copy('/', newPath)
    } else {
      await DPackVault.exportToVault({
        src: this._vault.url,
        dst: `dweb://${targetVaultKey}${newPath}`,
        skipUndownloadedFiles: true
      })
    }
  }

  async delete () {
    return DPackVault.unlink(this._vaultInfo.url)
  }
}

class VFSystemVaultFolder extends VFSystemVaultContainer {
  constructor (parent, vault, vaultInfo, name, path, stat) {
    super(parent, vault, vaultInfo)
    this._name = name
    this._path = path
    this._stat = stat
  }

  get url () { return this._vaultInfo.url + this._path }
  get type () { return 'folder' }
  get name () { return (this._name || '').trim() || 'Untitled' }
  get size () { return this._stat.size }
  get mtime () { return this._stat.mtime }

  copyDataFrom (node) {
    this._vaultInfo = node._vaultInfo
    this._vault = node._vault
    this._name = node._name
    this._path = node._path
    this._stat = node._stat
  }

  async rename (newName) {
    return rename(this, newName)
  }

  async copy (newPath, targetVaultKey) {
    if (this._vaultInfo.key === targetVaultKey) {
      await this._vault.copy(this._path, newPath)
    } else {
      await DPackVault.exportToVault({
        src: this._vault.url + this._path,
        dst: `dweb://${targetVaultKey}${newPath}`,
        skipUndownloadedFiles: true
      })
    }
  }

  async move (newPath, targetVaultKey) {
    if (this._vaultInfo.key === targetVaultKey) {
      await this._vault.rename(this._path, newPath)
    } else {
      await DPackVault.exportToVault({
        src: this._vault.url + this._path,
        dst: `dweb://${targetVaultKey}${newPath}`,
        skipUndownloadedFiles: true
      })
      await this._vault.rmdir(this._path, {recursive: true})
    }
  }

  async delete () {
    await this._vault.rmdir(this._path, {recursive: true})
  }
}

class VFSystemVaultFile extends VFSNode {
  constructor (parent, vault, vaultInfo, name, path, stat) {
    super()
    this.parent = parent
    this._vault = vault
    this._vaultInfo = vaultInfo
    this._name = name
    this._path = path
    this._stat = stat
    this.preview = null
  }

  get url () { return this._vaultInfo.url + this._path }
  get type () { return 'file' }
  get name () { return (this._name || '').trim() || 'Untitled' }
  get size () { return this._stat.size }
  get mtime () { return this._stat.mtime }
  get isEditable () { return this._vaultInfo.isOwner }

  async readData ({maxPreviewLength} = {}) {
    if (this.preview) {
      return
    }

    // only load a preview if this file type is (probably) textual
    // assume textual if no extension exists
    var nameParts = this.name.split('.')
    if (nameParts.length > 1) {
      let ext = nameParts.pop()
      if (ext && TEXTUAL_FILE_FORMATS.includes(ext) === false) {
        return
      }
    }

    // read the file and save the first 500 bytes
    try {
      var fileData = await this._vault.readFile(this._path, 'utf8')
      if (maxPreviewLength && fileData.length > maxPreviewLength) {
        fileData = fileData.slice(0, maxPreviewLength - 3) + '...'
      }
      this.preview = fileData
    } catch (e) {
      console.log('Failed to load preview', e, this)
    }
  }

  copyDataFrom (node) {
    this._vaultInfo = node._vaultInfo
    this._vault = node._vault
    this._name = node._name
    this._path = node._path
    this._stat = node._stat
    this.preview = node.preview || this.preview // preview may not be loaded yet so fallback to current
  }

  async rename (newName) {
    return rename(this, newName)
  }

  async copy (newPath, targetVaultKey) {
    if (this._vaultInfo.key === targetVaultKey) {
      await this._vault.copy(this._path, newPath)
    } else {
      await DPackVault.exportToVault({
        src: this._vault.url + this._path,
        dst: `dweb://${targetVaultKey}${newPath}`,
        skipUndownloadedFiles: true
      })
    }
  }

  async move (newPath, targetVaultKey) {
    if (this._vaultInfo.key === targetVaultKey) {
      await this._vault.rename(this._path, newPath)
    } else {
      await DPackVault.exportToVault({
        src: this._vault.url + this._path,
        dst: `dweb://${targetVaultKey}${newPath}`,
        skipUndownloadedFiles: true
      })
      await this._vault.unlink(this._path)
    }
  }

  async delete () {
    await this._vault.unlink(this._path)
  }
}

class VFSystemVaultFolder_BeingCreated extends VFSystemContainer {
  constructor (parent, vault, vaultInfo, parentPath) {
    super()
    this.parent = parent
    this._vault = vault
    this._vaultInfo = vaultInfo
    this._parentPath = parentPath
  }

  get url () { return this._vaultInfo.url + this._parentPath }
  get type () { return 'folder' }
  get name () { return 'New folder' }
  get size () { return 0 }
  get mtime () { return 0 }
  get isEmpty () { return true }
  get children () { return [] }
  get isEditable () { return true }

  copyDataFrom (node) {
    this._vaultInfo = node._vaultInfo
    this._vault = node._vault
    this._parentPath = node._parentPath
  }

  async rename (newName) {
    return this._vault.mkdir(this._parentPath + '/' + newName)
  }
}

async function rename (node, newName) {
  var oldpath = node._path
  var newpath = node._path.split('/').slice(0, -1).join('/') + '/' + newName
  await node._vault.rename(oldpath, newpath)
}

module.exports = {VFSystemVaultContainer, VFSystemVault, VFSystemVaultFolder, VFSystemVaultFile, VFSystemVaultFolder_BeingCreated}
