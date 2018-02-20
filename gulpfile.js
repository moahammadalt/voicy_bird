var gulp = require('gulp');

var browserSync = require('browser-sync').create();
browserSync.init({
	server: "./"
});
browserSync.stream();

gulp.task('default', (done)=>{
	//gulp.watch('*.*', gulp.series('watcher'));
	//gulp.watch('./js/*.*', gulp.series('watcher'));
	//gulp.watch('./css/*.*', gulp.series('browser-sync'));
	
	gulp.watch('*.*').on('change', browserSync.reload);
	gulp.watch('./js/*.*').on('change', browserSync.reload);
	gulp.watch('./css/*.*').on('change', browserSync.reload);
	
	console.log('gulp worked');
	done();
});

gulp.task('browser-sync', (done)=>{
	console.log('file has changed');
	
	done();
});

gulp.task('another_task', (done)=>{
	const a = 23;
	const b = 54;
	const c = a + b;
	console.log(`the sum result of ${a} and ${b} is ${c}`);

	done();
});

gulp.task('watcher', (done)=>{
	console.log('file has changed');

	done();
});