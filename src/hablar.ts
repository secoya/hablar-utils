#!/usr/bin/env node
import { docopt } from 'docopt';
import * as chokidar from 'chokidar';
import { compile } from './compilation';

var usage = [
	'Hablar - you know, for speak.',
	'The i18nDirectory should consist of one .yml file for every language you wish to provide translations for.',
	'Each file should be a YAML map - mapping from a translation key to a translation in the hablar language.',
	'Besides this there should also be a meta.yml file. The meta.yml file, for now, is only used to provide static',
	'types to the translations. The format should be:',
	'',
	'  ---',
	'  translation.key:',
	'    parameters:',
	'      n:',
	'        type: number',
	'',
	'Available types are: number, string, number-or-string, enum, gender, unknown.',
	'',
	'Usage:',
	'  hablar <i18nDirectory> <outputDirectory> [--watch]',
	'  hablar -h | --help | --version',
	'',
	'Options:',
	'  -w --watch    Watch for file changes',
	'  -h --help     Show this help message',
	'  --version     Show the version of this binary',
].join('\n');

var options = docopt(usage, { version: '1.0.0' });

function compileWithOptions() {
	return compile(options['<i18nDirectory>'], options['<outputDirectory>']);
}

function go() {
	if (running) {
		compileWhenDone = true;
		return;
	}
	running = true;
	compileWithOptions()
		.then(function () {
			console.log('Compiled i18n files!');
		})
		.catch(function (err) {
			console.error(err.message);
		})
		.then(function (err) {
			running = false;
			if (compileWhenDone) {
				compileWhenDone = false;
				go();
			}
		})
		.catch(function (err) {
			console.error(err.message);
			process.exit(1);
		});
}
if (!options['--watch']) {
	compileWithOptions().catch(function (err) {
		console.error(err.message);
		process.exit(1);
	});
} else {
	var compileWhenDone = false;
	var running = false;
	var watcher = chokidar.watch(options['<i18nDirectory>'], { ignored: /(^|[\/\\])\../ });
	watcher.on('ready', function () {
		watcher.on('add', go);
		watcher.on('change', go);
		go();
	});
}
