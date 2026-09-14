const ts = require('typescript');
const { pathToFileURL } = require('node:url');
const { default: tsJest } = require('ts-jest');

/**
 * Core is ESM; Jest executes its source in CommonJS. Translate only actual
 * import.meta.url expressions to that source file's URL before typechecking.
 * No diagnostics are suppressed, and strings/comments are left intact.
 */
function resolveImportMetaUrl(source, filename) {
    if (!source.includes('import.meta')) return source;
    const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
    const spans = [];
    function visit(node) {
        if (ts.isPropertyAccessExpression(node) && node.name.text === 'url' &&
            ts.isMetaProperty(node.expression) && node.expression.keywordToken === ts.SyntaxKind.ImportKeyword) {
            spans.push([node.getStart(file), node.end]);
        }
        ts.forEachChild(node, visit);
    }
    visit(file);
    const literal = JSON.stringify(pathToFileURL(filename).href);
    for (const [start, end] of spans.reverse()) source = source.slice(0, start) + literal + source.slice(end);
    return source;
}

module.exports = {
    resolveImportMetaUrl,
    createTransformer(options) {
        const delegate = tsJest.createTransformer(options);
        return {
            canInstrument: delegate.canInstrument,
            getCacheKey(source, filename, context) {
                return delegate.getCacheKey(resolveImportMetaUrl(source, filename), filename, context);
            },
            process(source, filename, context) {
                return delegate.process(resolveImportMetaUrl(source, filename), filename, context);
            }
        };
    }
};
