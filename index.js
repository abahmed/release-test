const octokit = require('@octokit/rest')()
const fs = require('fs')
const mime = require('mime')
const path = require('path')
const glob = require('glob-fs')({ gitignore: true });

var NightlyDeploy = {
  release: {},
  uploadedAssets: [],
  filteredAssets: [],
  config: {
    owner: null,
    repo: null,
    branch: null,
    tag: null,
    assets: [],
    dir: null,
    token: ''
  },

  // Initialize NightlyDeploy.
  init(config) {
    this.config = config

    // Makes sure of asstes that will be uploaded.
    this.filteredAssets = this.config.assets.filter(asset => {
      let assetUrl = path.join(this.config.dir, asset)
      return fs.existsSync(assetUrl)
    })
    if (this.filteredAssets.length === 0) {
      console.log('There are no assets to upload...')
      return
    }

    this.authenticate()
    this.getRelease()
  },

  // Authenticating user token.
  authenticate () {
    if (!this.config.token) {
      throw new Error("Token is not provided")
    }
    console.log('Authenticating...')
    octokit.authenticate({
      type: 'token',
      token: this.config.token
    })
  },

  // Tries to check whether release is existing or not.
  // If it exists, delete it. Otherwise create new one.
  getRelease() {
    console.log('Getting relesae info...')
    octokit.repos.getReleaseByTag({
      owner: this.config.owner,
      repo: this.config.repo,
      tag: this.config.tag
    }).then(result => {
      // Release is already created.
      console.log(this.config.tag + ' is existing, so it will be deleted')
      this.release = result.data
      this.deleteRelease(result.data.id)
    }).catch(e => {
      console.log('Unable to get release info...')
      if (e.code === 404) {
        // Create the release as it does not exist.
        this.createRelease('nightly builds', 'nightly builds')
      }
      else {
        throw new Error('Unhandled response for getReleaseByTag: ' + e)
      }

    })
  },

  // Deletes release with releaseId, then creates new one.
  deleteRelease(releaseId) {
    console.log('Deleting release...')
    octokit.repos.deleteRelease({
      owner: this.config.owner,
      repo: this.config.repo,
      release_id: releaseId
    }).then(result => {
      console.log('Release is deleted successfully...')
      // Use previous name and body.
      let name = this.release.name
      let body = this.release.body

      // Free release object.
      this.release = null

      this.createRelease(name, body)
    }).catch(e => {
      throw new Error('Unhandled response for deleteRelease: ' + e)
    })
  },

  // Creates release with name and body using provided configs, then it calls
  // uploadAllAssets.
  createRelease(name, body) {
    console.log('Creating a new release...')
    octokit.repos.createRelease({
      owner: this.config.owner,
      repo: this.config.repo,
      tag_name: this.config.tag,
      name: name,
      body: body,
      target_commitish: this.config.branch,
      draft: false,
      prerelease: true
    }).then(result => {
      console.log('Release is created successfully...')
      this.release = result.data
      this.uploadedAssets = []
      this.uploadAllAssets()
    }).catch(e => {
      throw new Error('Unhandled response for createRelease: ' + e)
    })
  },

  // Gets a list for assets of a release to avoid conflicts while uploading
  // new assets by deleting them, then it calls uploadAllAssets.
  getAssets(releaseId) {
    console.log('Getting assets...')
    octokit.repos.getAssets({
      owner: this.config.owner,
      repo: this.config.repo,
      release_id: releaseId,
      per_page: 100
    }).then(result => {
      this.uploadedAssets = result.data.map(asset => {
        return { name: asset.name, id: asset.id }
      })

      this.uploadAsset(0)
    }).catch(function(e) {
      throw new Error('Unhandled response for getAssets: ' + e)
    })
  },

  // Uploads asset for a release if it's not already uploaded, Otherwise
  // calls deleteAsset.
  uploadAsset(assetIndex) {
    if (assetIndex >= this.filteredAssets.length) {
      console.log('Assets uploaded successfully...')
      return
    }

    let asset = this.filteredAssets[assetIndex]
    console.log('Uploading ' + asset)

    // Check if it's uploaded.
    let assetId = this.getAssetId(assetIndex)
    if (assetId != -1) {
      console.log(asset + ' is existing, so it will be deleted')
      // Asset exists, so we need to delete it first.
      this.deleteAsset(assetId, assetIndex)
      return
    }

    let assetUrl = path.join(this.config.dir, asset)
    octokit.repos.uploadAsset({
      url: this.release.upload_url,
      file: fs.readFileSync(assetUrl),
      contentType: mime.getType(assetUrl),
      contentLength: fs.statSync(assetUrl).size,
      name: asset,
    }).then(result => {
      console.log('Uploaded successfully...')
      this.uploadAsset(assetIndex + 1)
    }).catch(function(e) {
      throw new Error('Unhandled response for uploadAsset: ' + e)
    })
  },

  // Deletes old asset with assetId, then it calls uploadAsset to upload new
  // one.
  deleteAsset(assetId, assetIndex) {
    console.log('Deleting ' + this.filteredAssets[assetIndex])
    octokit.repos.deleteAsset({
      owner: this.config.owner,
      repo: this.config.repo,
      asset_id: assetId
    }).then(result => {
      console.log('Deleted successfully...')
      this.deleteAssetId(assetId)
      this.uploadAsset(assetIndex)
    }).catch(function(e) {
      throw new Error('Unhandled response for deleteAsset: ' + e)
    })
  },

  // Returns id for asset to be used in deleting it.
  getAssetId(index) {
    let newAsset = this.filteredAssets[index]
    let result = this.uploadedAssets.find(asset => asset.name === newAsset)
    if (result && result.id) {
      return result.id
    }
    return -1
  },

  // Removes asset from uploadedAssets list.
  deleteAssetId(assetId) {
    this.uploadedAssets =
      this.uploadedAssets.filter(asset => asset.id !== assetId)
  }
}

// Handles errors.
process.on('unhandledRejection', error => {
  console.log('Failed to deploy')
  console.log('unhandledRejection', error)
  process.exit(1)
})

function getAssetNames(files = []) {
  let result = []
  files.forEach(pattern => {
    result =
      result.concat(glob.readdirSync(pattern).map(file => path.basename(file)))
  })
  return result
}

const assets = [
  './dist/*.deb',
  './dist/*.rpm',
  './dist/*.zip',
  './dist/*.dmg',
  './dist/*.exe'
]

const repoSlug = process.env.TRAVIS_REPO_SLUG
if (repoSlug != 'abahmed/Deer') {
  console.log('Deployment is only done for abahmed/Deer')
  process.exit()
}

const isPullRequest = process.env.TRAVIS_PULL_REQUEST !== false
if (isPullRequest) {
  console.log('Deployment is not done for Pull Requests')
  process.exit()
}

const branch = process.env.TRAVIS_BRANCH
if (branch === 'develop') {
  NightlyDeploy.init({
    owner: 'abahmed',
    repo: 'release-test',
    branch: branch,
    tag: 'nightly',
    assets: getAssetNames(assets),
    dir:'./dist',
    token: process.env.GH_TOKEN
  })
}
else {
  console.log('No deployments for ' + branch)
}
