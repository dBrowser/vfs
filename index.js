const base = require('./base')
const virtual = require('./virtual')
const vault = require('./vault')
module.exports = Object.assign({}, base, virtual, vault)
