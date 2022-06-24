import T from 'ast-types';
import { PropertyKind } from 'ast-types/gen/kinds';
import * as fs from 'async-file';
import { analyzeTranslations, TypedTranslation as HablarTypedTranslation } from 'hablar/lib/analysis/combined';
import Context from 'hablar/lib/emitting/context';
import { encodeIfStringFunction } from 'hablar/lib/emitting/helpers';
import { emitTranslation } from 'hablar/lib/emitting/translation';
import parseConstraint, { ConstraintParserResult } from 'hablar/lib/parsers/constraint';
import parseText, { TextParserResult } from 'hablar/lib/parsers/text';
import TypeMap, { InferredType } from 'hablar/lib/type_map';
import * as path from 'path';
import { prettyPrint } from 'recast';
import * as yaml from 'yaml';

const b = T.builders;

type Translation = SimpleTranslation | ComplexTranslation;

const enum TranslationKind {
	Simple = 'simple',
	Complex = 'complex',
}

interface SimpleTranslation {
	kind: TranslationKind.Simple;
	translationKey: string;
	translationText: TextParserResult;
}

interface ComplexTranslation {
	iterations: ConstrainedTranslation[];
	kind: TranslationKind.Complex;
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
			translationKey: key,
			translationText: parseText(translation),
		};
	}

	if (typeof translation !== 'object' || translation === null) {
		// tslint:disable:next-line no-console
		console.error(translation);
		throw new Error('Invalid translation ' + key);
	}

	const iterations: ConstrainedTranslation[] = Object.keys(translation).map((k) => {
		const text = translation[k];

		if (typeof text !== 'string') {
			throw new Error('Invalid translation ' + k);
		}

		return {
			constraints: parseConstraint(k),
			translation: parseText(text),
		};
	});

	return {
		iterations: iterations,
		kind: TranslationKind.Complex,
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

	Object.keys(parsed).forEach((key) => {
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
		Object.keys(typeMapEntry.parameters).forEach((paramName) => {
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

	Object.keys(parsed).forEach((key) => {
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

function compileFile(translations: TypedTranslation[], typeMaps: { [key: string]: TypeMap }): string {
	const properties: PropertyKind[] = [];
	const codeGenContext = new Context();

	translations.forEach((translation) => {
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

	const translationKeys: { [key: string]: { locale: string; translation: Translation }[] } = {};

	await Promise.all(
		fileNames
			.filter((f) => f.endsWith('.yml') && f !== 'meta.yml')
			.map(async (fileName) => {
				const translationFile = await readTranslationFile(path.join(i18nFolder, fileName));
				const locale = fileName.substr(0, fileName.length - '.yml'.length);
				translationFile.forEach((translation) => {
					if (translationKeys[translation.translationKey] == null) {
						translationKeys[translation.translationKey] = [];
					}
					translationKeys[translation.translationKey].push({
						locale: locale,
						translation: translation,
					});
				});
			}),
	);

	const analyzedTranslationFiles: { locale: string; translations: TypedTranslation[] }[] = [];

	function getTranslationsForLocale(
		map: { [locale: string]: TypedTranslation[] },
		locale: string,
	): TypedTranslation[] {
		if (map[locale] == null) {
			const translations: TypedTranslation[] = [];
			analyzedTranslationFiles.push({ locale: locale, translations: translations });
			map[locale] = translations;
		}
		return map[locale];
	}

	Object.keys(translationKeys).reduce((carry, trKey) => {
		const parsedTranslations = translationKeys[trKey];
		const typeMap = getTypeMap(typeMaps, trKey);
		const hablarTranslations = parsedTranslations.map((t) => {
			if (t.translation.kind === TranslationKind.Simple) {
				return t.translation.translationText;
			} else {
				return t.translation.iterations;
			}
		});
		const analyzed = analyzeTranslations(hablarTranslations, typeMap);
		parsedTranslations.forEach((parsedTr, idx) => {
			getTranslationsForLocale(carry, parsedTr.locale).push({
				translation: analyzed[idx],
				translationKey: trKey,
			});
		});
		return carry;
	}, {} as { [locale: string]: TypedTranslation[] });

	await fs.mkdirp(compiledFolder);
	await compileHelper(compiledFolder);
	await Promise.all(
		analyzedTranslationFiles.map((file) => {
			const code = compileFile(file.translations, typeMaps);

			return fs.writeFile(path.join(compiledFolder, file.locale + '.js'), code, 'utf8');
		}),
	);
}
