var _ = require('lodash')
var request = require('request-promise')
var express = require('express')
var bodyParser = require('body-parser')
var escapeStringRegexp = require('escape-string-regexp')
var diff = require('loot-diff')

var API_URL = process.env.API_URL || 'https://api.github.com'

var GITHUB_API_TOKEN = process.env.GITHUB_API_TOKEN
if (!GITHUB_API_TOKEN) {
  throw new Error('`GITHUB_API_TOKEN` env variable is not set!')
}

var SERVER_ENDPOINT = process.env.SERVER_ENDPOINT
if (!SERVER_ENDPOINT) {
  throw new Error('`SERVER_ENDPOINT` env variable is not set!')
}

var OLD_ENDPOINTS = process.env.OLD_ENDPOINTS || ''

var YO_API_TOKEN = process.env.YO_API_TOKEN
if (!YO_API_TOKEN) {
  throw new Error('YO_API_TOKEN` env variable is not set!')
}

var defaultConfig = {
  headers: {
    'Authorization': 'token ' + GITHUB_API_TOKEN,
    'User-Agent': 'yo-starred'
  },
  json: true
}

function getRepos () {
  var endpoint = API_URL + '/user/repos'
  var config = _.assign({
    qs: {
      'affiliation': 'owner',
      'per_page': 100
    }
  }, defaultConfig)
  return request.get(endpoint, config)
}

function getHooks (repo) {
  var endpoint = API_URL + '/repos/' + repo.full_name + '/hooks'
  return request.get(endpoint, defaultConfig)
}

/**
 * Regex generator to identify webhooks created by this script. Useful when
 * testing with ngrok, where 'domain' (and therefore endpoint) can change.
 */
var endpoints = OLD_ENDPOINTS.split(',').concat(SERVER_ENDPOINT)
endpoints = _.map(endpoints, escapeStringRegexp)
endpoints = _.filter(endpoints, function (endpoint) {
  return endpoint && endpoint.length
})
var endpointRe = new RegExp('(' + endpoints.join('|') + ')')
console.log('endpointRe', endpointRe)

var hookConfig = _.assign({
  body: {
    name: 'web',
    active: true,
    events: ['watch'],
    config: {
      url: SERVER_ENDPOINT + '/call-me-maybe',
      content_type: 'json'
    }
  },
  json: true
}, defaultConfig)

// hook name can't be modified and should always be 'web'
function getHookToUpdate (hooks) {
  return hooks.find(function (hook) {
    return hook.name === hookConfig.body.name &&
      endpointRe.test(hook.config.url)
  })
}

function createStarHook (repo) {
  var endpoint = API_URL + '/repos/' + repo.full_name + '/hooks'
  console.log('create ' + endpoint)
  return request.post(endpoint, hookConfig)
}

function updateStarHook (repo, hook) {
  var changes = diff(hook, hookConfig.body)
  changes = _.pick(changes, ['name', 'events', 'active', 'config'])
  // modifying `config` will replace the entire object, so no partial changes
  if (changes.config != null) changes.config = hookConfig.body.config
  if (_.size(changes) === 0) return
  var endpoint = API_URL + '/repos/' + repo.full_name + '/hooks/' + hook.id
  var updateConfig = _.clone(hookConfig)
  updateConfig.body = changes
  console.log('update ' + endpoint, changes)
  console.log(hook)
  return request.post(endpoint, updateConfig)
}

function createOrUpdateStarHook (repo) {
  return getHooks(repo).then(function (hooks) {
    var hook = getHookToUpdate(hooks)
    if (hook) return updateStarHook(repo, hook)
    else return createStarHook(repo)
  })
}

var app = express()
app.use(bodyParser.json())

app.post('/call-me-maybe', function (req, res) {
  var repo = req.body.repository.full_name
  var user = req.body.sender.login
  var stars = req.body.repository.stargazers_count
  var message = user + ' starred ' + repo + ', now ' + stars + ' stars!'
  console.log(message)
  res.status(200).send('Got it!')
  request.post('http://api.justyo.co/yo/', {
    form: {
      api_token: YO_API_TOKEN,
      username: 'dasilvacontin',
      text: message
    }
  })
})

function getAccessToken (code) {
  var endpoint = 'https://github.com/login/oauth/access_token'
  return request(endpoint, {
    headers: {
      'User-Agent': 'yo-starred'
      'Accept': 'application/json'
    },
    json: true,
    body: {
      cliend_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code: code
    }
  })
}

function setUpUser (accessToken) {
  return getRepos(accessToken).then(function (repos) {
    var handleHookForUser = _.partial(createOrUpdateStarHook, accessToken)
    var promises = repos.map(handleHookForUser)
    return Promise.all(promises)
  }).then(function () {
    console.log(accessToken + ' was correctly set up')
  })
}

app.post('/register', function (req, res) {
  var code = req.body.code
  getAccessToken(code).then(function (auth) {
    return setUpUser(auth.access_token)
  }).then(function () {

  }).catch(function (err) {

  })
})

var port = process.env.PORT || 4242
app.listen(port)
console.log('yo-starred server running on port ' + port)
