const config = require('./config')

module.exports = config.useLocalApi
  ? require('./api-local')
  : require('./api-remote')
