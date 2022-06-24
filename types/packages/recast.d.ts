import { NodeKind } from 'ast-types/gen/kinds';
import T from 'ast-types';

export interface SourceMap {}

export function prettyPrint(
	node: NodeKind,
	options?: {
		tabWidth?: number;
		useTabs?: boolean;
		reuseWhitespace?: boolean;
		lineTerminator?: string;
		wrapColumn?: number;
		sourceFileName?: string;
		sourceMapName?: string;
		sourceRoot?: string;
		inputSourceMap?: SourceMap;
		tolerant?: boolean;
		quote?: 'single' | 'double' | 'auto';
		trailingComma?: boolean;
		arrowParensAlways?: boolean;
		flowObjectCommas?: boolean;
	},
): {
	code: string;
	map: SourceMap;
};

export function print(
	node: NodeKind,
	options?: {
		tabWidth?: number;
		useTabs?: boolean;
		reuseWhitespace?: boolean;
		lineTerminator?: string;
		wrapColumn?: number;
		sourceFileName?: string;
		sourceMapName?: string;
		sourceRoot?: string;
		inputSourceMap?: SourceMap;
		tolerant?: boolean;
		quote?: 'single' | 'double' | 'auto';
		trailingComma?: boolean;
		arrowParensAlways?: boolean;
		flowObjectCommas?: boolean;
	},
): {
	code: string;
	map: SourceMap;
};

export var types: { builders: typeof T['builders'] };
