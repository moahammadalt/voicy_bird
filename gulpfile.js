'use strict';

/**
 * Dev server with live reload.
 *
 *   npm start   →  http://localhost:3000
 *
 * The game needs a secure context for the microphone (localhost counts), so
 * always run it through a server rather than opening index.html directly.
 */
const { watch } = require('gulp');
const browserSync = require('browser-sync').create();

function serve(done) {
  browserSync.init({
    server: { baseDir: './' },
    port: 3000,
    open: false,
    notify: false,
    ui: false
  });
  watch(['index.html', 'css/**/*.css', 'js/**/*.js']).on('change', browserSync.reload);
  done();
}

exports.serve = serve;
exports.default = serve;
