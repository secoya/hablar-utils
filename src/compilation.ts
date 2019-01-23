import * as fs from 'async-file';
import T from 'ast-types';
import * as yaml from 'yaml';
import { prettyPrint } from 'recast';
import * as path from 'path';
import parseText, { TextParserResult } from 'hablar/lib/parsers/text';
import parseConstraint, { ConstraintParserResult } from 'hablar/lib/parsers/constraint';
import TypeMap, { InferredType } from 'hablar/lib/type_map';
import { analyzeTranslation, TypedTranslation as HablarTypedTranslation } from 'hablar/lib/analysis/combined';
import { emitTranslation } from 'hablar/lib/emitting/translation';
import Context from 'hablar/lib/emitting/context';
import { encodeIfStringFunction } from 'hablar/lib/emitting/helpers';
import { PropertyKind } from 'ast-types/gen/kinds';

const b = T.builders;

type Translation = SimpleTranslation | ComplexTranslation;

const enum TranslationKind {
	Simple = 'simple',
	Complex = 'complex',
}

interface SimpleTranslation {
	kind: TranslationKind.Simple;
	translationText: TextParserResult;
	translationKey: string;
}

interface ComplexTranslation {
	kind: TranslationKind.Complex;
	iterations: ConstrainedTranslation[];
	translationKey: string;
}

interface ConstrainedTranslation {
	constraints: ConstraintParserResult;
	translation: TextParserResult;
}

interface TypedTranslation {
	translation: HablarTypedTranslation;
	translationKey: string;
}

function mapTranslation(key: string, translation: any): Translation {
	if (typeof translation === 'string') {
		return {
			kind: TranslationKind.Simple,
			translationText: parseText(translation),
			translationKey: key,
		};
	}

	if (typeof translation !== 'object' || translation === null) {
		console.error(translation);
		throw new Error('Invalid translation ' + key);
	}

	const iterations: ConstrainedTranslation[] = Object.keys(translation).map(key => {
		const text = translation[key];

		if (typeof text !== 'string') {
			throw new Error('Invalid translation ' + key);
		}

		return {
			constraints: parseConstraint(key),
			translation: parseText(text),
		};
	});

	return {
		kind: TranslationKind.Complex,
		iterations: iterations,
		translationKey: key,
	};
}

async function readTranslationFile(file: string): Promise<Translation[]> {
	const contents = await fs.readFile(file, 'utf8');

	const parsed = yaml.parse(contents, {
		schema: 'failsafe',
	});

	if (typeof parsed !== 'object' || parsed == null) {
		throw new Error('Bad translation YAML');
	}

	const translations: Translation[] = [];

	Object.keys(parsed).forEach(key => {
		translations.push(mapTranslation(key, parsed[key]));
	});

	return translations;
}

function mapTypeMap(key: string, typeMapEntry: any): TypeMap {
	if (typeof typeMapEntry !== 'object' || typeMapEntry == null) {
		throw new Error('Bad type map entry for key: ' + key);
	}

	const typeMap = new TypeMap();

	if (typeMapEntry.parameters != null) {
		if (typeof typeMapEntry.parameters !== 'object') {
			throw new Error('Invalid parameters entry');
		}
		Object.keys(typeMapEntry.parameters).forEach(paramName => {
			const param = typeMapEntry.parameters[paramName];

			if (param == null) {
				throw new Error(`Parameter ${paramName} config is null for ${key}`);
			}

			const specifiedType = param.type;

			if (
				typeof specifiedType !== 'string' ||
				['enum', 'gender', 'number-or-string', 'number', 'string', 'unknown'].indexOf(specifiedType) < 0
			) {
				throw new Error(`Bad type map entry for param ${paramName} for key ${key}`);
			}

			typeMap.addTypeUsage(paramName, specifiedType as InferredType, {
				nodeType: 'custom',
			});
		});
	}
	return typeMap;
}

async function readTypeMapFile(file: string): Promise<{ [key: string]: TypeMap }> {
	const contents = await fs.readFile(file, 'utf8');

	const parsed = yaml.parse(contents, {
		schema: 'failsafe',
	});

	if (typeof parsed !== 'object' || parsed == null) {
		throw new Error('Bad type map YAML');
	}

	const typeMaps: { [key: string]: TypeMap } = {};

	Object.keys(parsed).forEach(key => {
		typeMaps[key] = mapTypeMap(key, parsed[key]);
	});

	return typeMaps;
}

function getTypeMap(typeMaps: { [key: string]: TypeMap }, translationKey: string): TypeMap {
	const map = typeMaps[translationKey];

	if (map != null) {
		return map;
	}

	return (typeMaps[translationKey] = new TypeMap());
}

function inferTypes(typeMaps: { [key: string]: TypeMap }, translations: Translation[]): TypedTranslation[] {
	return translations.map(translation => {
		const typeMap = getTypeMap(typeMaps, translation.translationKey);

		if (translation.kind === TranslationKind.Simple) {
			return {
				translationKey: translation.translationKey,
				translation: analyzeTranslation(translation.translationText, typeMap),
			};
		} else {
			return {
				translationKey: translation.translationKey,
				translation: analyzeTranslation(translation.iterations, typeMap),
			};
		}
	});
}

function compileFile(translations: TypedTranslation[], typeMaps: { [key: string]: TypeMap }): string {
	const properties: PropertyKind[] = [];
	const codeGenContext = new Context();

	translations.forEach(translation => {
		const typeMap = getTypeMap(typeMaps, translation.translationKey);
		const emitted = emitTranslation(translation.translation, codeGenContext, typeMap);

		properties.push(b.property('init', b.literal(translation.translationKey), emitted));
	});

	const objectExpr = b.objectExpression(properties);

	const statements = [
		b.importDeclaration([b.importSpecifier(codeGenContext.encodeIfStringExpr)], b.literal('./helper')),
		b.exportNamedDeclaration(
			b.variableDeclaration('const', [b.variableDeclarator(b.identifier('translations'), objectExpr)]),
		),
	];

	return prettyPrint(b.program(statements), { quote: 'auto' }).code;
}

async function compileHelper(outputFolder: string): Promise<void> {
	const code = prettyPrint(b.exportDeclaration(false, encodeIfStringFunction(new Context())), { quote: 'auto' }).code;

	await fs.writeFile(path.join(outputFolder, 'helper.js'), code, 'utf8');
}

export async function compile(i18nFolder: string, compiledFolder: string): Promise<void> {
	const metaFile = path.join(i18nFolder, 'meta.yml');
	if (!(await fs.exists(metaFile))) {
		throw new Error('A meta.yml file does not exist within the i18n folder: ' + i18nFolder);
	}
	const typeMaps = await readTypeMapFile(metaFile);

	const fileNames = await fs.readdir(i18nFolder);

	const translationFiles = await Promise.all(
		fileNames
			.filter(f => f.endsWith('.yml') && f !== 'meta.yml')
			.map(async fileName => {
				const translationFile = await readTranslationFile(path.join(i18nFolder, fileName));
				return {
					locale: fileName.substr(0, fileName.length - '.yml'.length),
					translations: inferTypes(typeMaps, translationFile),
				};
			}),
	);

	Object.keys(typeMaps).forEach(key => {
		typeMaps[key].freeze();
	});

	await fs.mkdirp(compiledFolder);
	await compileHelper(compiledFolder);
	await Promise.all(
		translationFiles.map(file => {
			const code = compileFile(file.translations, typeMaps);

			return fs.writeFile(path.join(compiledFolder, file.locale + '.js'), code, 'utf8');
		}),
	);
}
