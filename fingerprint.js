/* jshint node: true */

// this file is a spike, it will be refactored and properly tested as time
// permits.
//  - sp
//  TODO:
//  [ ] configurable asset host[s]
//  [ ] configurable input DIR and target DIR's
//  [ ] TDD a refactor for clarity and maintainability
//  [ ] handle fonts with strange suffixes such as ? # correctly
//  [ ] white list should be configurable
//  [ ] should be a proper commandline tool
//  [ ] saner matching and rewriting semantics.

var walkSync = require('walk-sync');
var RSVP = require('rsvp');
var Promise = RSVP.Promise;
var denodeify = RSVP.denodeify;

var fs = require('fs-extra');
var MD5 = require('MD5');
var readFile = denodeify(fs.readFile);
var stat = denodeify(fs.stat);
var filter = RSVP.filter;
var map = RSVP.map;
var path = require('path');
var mkdir = denodeify(fs.mkdir);
var copy = denodeify(fs.copy);
var rimraf = require('rimraf');
var writeFile = denodeify(fs.writeFile);

RSVP.on('error', function(reason) {
  throw reason;
});

var WHITE_LIST_REGEXP = /(\.js|\.css|crossdomain\.xml|humans\.txt|index\.html|robots\.txt|\.DS_Store|\.ttf|\.svg|\.woff)$/;
var FOLDER_REGEXP = /\/$/;
var CSS_URL_REGEXP = /url\(["']?([^\)\?]+["']?)\)/g;
var ASSET_HOST = '<some asset host>';
var HREF_REGEXP = /\s(href|src)\=["'](\/{1}[\/]?[^'"]+)["']/g;
var root = process.cwd();

var basePath = path.join(root, 'dist');

function filePathWithFingerprint(filePath, fingerprint) {
  var dirname = path.dirname(filePath);
  var basename = path.basename(filePath);
  var extension = path.extname(filePath);
  var withoutExtension = basename.replace(new RegExp(extension + "$"), '');

  var fingerprinted = withoutExtension + '-' + fingerprint + extension;

  return dirname + '/' + fingerprinted;
}

function buildManifest(files) {
  var manifest = Object.create(null);

  files.forEach(function(file) {
    // configurable baseURL
    manifest['/' + file.path] = '/' + file.fingerprinted;
  });

  return manifest;
}

var ALL_FILES = walkSync('dist');
var whitelist = ALL_FILES.filter(function(filePath) {
  return WHITE_LIST_REGEXP.test(filePath);
});

function hasExtension(file, ext) {
  return file && ext.test(file);
}

function buildFingerprintedDist(manifest) {
  try {
    rimraf.sync('dist-fingerprinted');
  } catch(e) { }

  return mkdir('dist-fingerprinted').then(function() {


    // copy fingerprinted files
    var actions = Object.keys(manifest).map(function(key) {
      return copy(path.join('dist', key), path.join('dist-fingerprinted', manifest[key]));
    });

        // copy whitelisted files
    whitelist.forEach(function(file) {
      if (hasExtension(file, /\.css$/)) { return; } // don't copy css files yet

      actions.push(copy(path.join('dist', file), path.join('dist-fingerprinted', file)));
    });

    actions.push(function(){
      ALL_FILES.filter(function(filePath) {
        return hasExtension(filePath, /\.css$/);
      }).map(function(filePath) {
        return readFile(path.join('dist', filePath)).then(function(file) {
          var fingerprinted = file.toString().replace(CSS_URL_REGEXP, function(match, url) {
            if (manifest[url]) {
              return 'url(' + manifest[url]+ ')';
            } else {
              if (!/^data:/.test(url)) {
                console.warn('No manifest entry for: `' + url + '`,');
              }
              return "url(" + url + ")";
            }
          });

          var fingerprintedPath = fingerprintFile(filePath, fingerprinted).fingerprinted;
          manifest['/' + filePath] = '/' + fingerprintedPath;
          return writeFile(path.join('dist-fingerprinted', fingerprintedPath), fingerprinted);
        }).then(function(){
          // write manifest
          var stringifiedManifest = JSON.stringify(manifest);
          var fingerprintedManifest = fingerprintFile('manifest.json', stringifiedManifest);
          // write the manifest
          return writeFile(path.join('dist-fingerprinted', fingerprintedManifest.fingerprinted), stringifiedManifest);
        });
      });
    }());

    return Promise.all(actions).then(function() {
      var filePath = path.join('dist-fingerprinted', 'index.html');

      return readFile(filePath).then(function(file){
        var fingerprintedIndex = file.toString().replace(HREF_REGEXP, function(match, protocol, href){

          var fingerprinted = manifest[href];
          if (fingerprinted) {
            return ' ' + protocol + '="' + ASSET_HOST + fingerprinted + '"';
          } else {
            return ' ' + protocol + '="' + ASSET_HOST + href + '"';
          }
        });

        fingerprintedIndex = fingerprintedIndex.replace(/\/\/.*@@MANIFEST@@/, 'MANIFEST = ' + JSON.stringify(manifest) + ';');
        fingerprintedIndex = fingerprintedIndex.replace(/\/\/.*@@ASSET_HOST@@/, 'ASSET_HOST = "' + ASSET_HOST + '";');

        return writeFile(filePath, fingerprintedIndex);
      });
    });
  });
}

function fingerprintFile(filePath, buffer) {
  var fingerprint = MD5(filePath + MD5(buffer));
  var fingerprinted = filePathWithFingerprint(filePath, fingerprint);

  return {
    path: filePath,
    fingerprinted: fingerprinted,
    fingerprint: fingerprint
  };
}

filter(ALL_FILES, function(filePath) {
  return !WHITE_LIST_REGEXP.test(filePath) && !FOLDER_REGEXP.test(filePath);
}).then(function(files) {
  return map(files, function(filePath) {
    return readFile(path.join(basePath, filePath)).
      then(fingerprintFile.bind(null, filePath));
    });
  }).
    then(buildManifest).
    then(buildFingerprintedDist);

