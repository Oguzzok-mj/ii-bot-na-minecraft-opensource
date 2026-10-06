'use strict'
const fs = require('node:fs')

module.exports = args => {
  if (args[0] === '--options-file') {
    if (!args[1]) throw new Error('Не указан файл параметров подключения.')
    return JSON.parse(fs.readFileSync(args[1], 'utf8'))
  }
  return JSON.parse(args[0] || '{}')
}
