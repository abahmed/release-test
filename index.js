const octokit = require('@octokit/rest')()
const fs = require('fs')
const mime = require('mime')
const path = require('path')

var NightlyRelease = {
  release: {},
  uploadedAssets: [],
  filteredAssets: [],
  config: {
    owner: null,
    repo: null,
    branch: null,
    tag: null,
    assets: [],
    dir: null
  },
  init(config) {
    this.config = config
    this.authenticate()
    this.getRelease()
  },
  authenticate () {
    console.log('Authenticating...')
    octokit.authenticate({
      type: 'token',
      token: process.env.GH_TOKEN
    })
  },
  getRelease() {
    console.log('Getting relesae info...')
    octokit.repos.getReleaseByTag({
      owner: this.config.owner,
      repo: this.config.repo,
      tag: this.config.tag
    }).then(result => {
      // Release is already created.
      this.deleteRelease(result.data.id)
    }).catch(e => {
      console.log('Unable to get release info...')
      if (e.code === 404) {
        // Create the release as it does not exist.
        this.createRelease()
      }
      else {
        throw('Unhandled response for getReleaseByTag: ' + e)
      }

    })
  },
  deleteRelease(releaseId) {
    console.log('Deleting release...')
    octokit.repos.deleteRelease({
      owner: this.config.owner,
      repo: this.config.repo,
      release_id: releaseId
    }).then(result => {
      console.log('Release is deleted successfully...')
      this.createRelease()
    }).catch(e => {
      throw('Unhandled response for deleteRelease: ' + e)
    })
  },
  createRelease() {
    console.log('Creating a new release...')
    octokit.repos.createRelease({
      owner: this.config.owner,
      repo: this.config.repo,
      tag_name: this.config.tag,
      name: 'nightly builds',
      body: 'nightly builds',
      target_commitish: process.env.TRAVIS_COMMIT,
      draft: false,
      prerelease: true
    }).then(result => {
      console.log('Release is created successfully...')
      this.release = result.data
      this.uploadedAssets = []
      this.uploadAllAssets()
    }).catch(e => {
      throw('Unhandled response for createRelease: ' + e)
    })
  },
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

      this.uploadAllAssets()
    }).catch(function(e) {
      throw('Unhandled response for getAssets: ' + e)
    })
  },
  uploadAllAssets() {
    this.filteredAssets = this.config.assets.filter(asset => {
      let assetUrl = path.join(this.config.dir, asset)
      return fs.existsSync(assetUrl)
    })
    if (this.filteredAssets.length === 0) {
      console.log('There are no assets to upload...')
      return
    }
    this.uploadAsset(0)
  },
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
      throw('Unhandled response for uploadAsset: ' + e)
    })
  },
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
      throw('Unhandled response for deleteAsset: ' + e)
    })
  },
  getAssetId(index) {
    let newAsset = this.filteredAssets[index]
    let result = this.uploadedAssets.find(asset => asset.name === newAsset)
    if (result && result.id) {
      return result.id
    }
    return -1
  },
  deleteAssetId(assetId) {
    this.uploadedAssets =
      this.uploadedAssets.filter(asset => asset.id !== assetId)
  }
}

NightlyRelease.init({
  owner: 'abahmed',
  repo: 'release-test',
  branch: 'master',
  tag: 'nightly',
  assets: ['dist.txt'],
  dir:'./dist'
})
