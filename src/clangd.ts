// eslint-disable-next-line import/no-unresolved
import * as monaco from 'monaco-editor/editor/editor.api';
import type {
  CodeAction, Command, CompletionItem, CompletionList, Diagnostic, DocumentHighlight, DocumentSymbol, Hover,
  InitializeResult, Location, LocationLink, MarkedString, MarkupContent, Position, PublishDiagnosticsParams, Range,
  SemanticTokens, ServerCapabilities, SignatureHelp, SymbolInformation, TextEdit, WorkDoneProgressBegin,
  WorkDoneProgressEnd, WorkDoneProgressReport, WorkspaceEdit,
} from 'vscode-languageserver-protocol';
import { t } from './localization';
import { baseName, pathUri } from './paths';
import { restyleSemanticTokens, styledModifiers } from './themes';

export interface ClangdHost {
  // A model for reading, created without a tab when needed. Null if the file cannot be read.
  loadModel(uri: monaco.Uri): Promise<monaco.editor.ITextModel | null>;
  // A model in an editable tab, opened in the background when needed. Null if it cannot be edited.
  openForEdit(uri: monaco.Uri): Promise<monaco.editor.ITextModel | null>;
  log(text: string): void;
  status(text: string | null, busy: boolean): void;
}

interface Message {
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

interface Pending {
  resolve(result: unknown): void;
  reject(error: Error): void;
}

interface Progress {
  token: number | string;
  value: WorkDoneProgressBegin | WorkDoneProgressReport | WorkDoneProgressEnd;
}

const owner = 'clangd';
const applyEditCommand = 'glist.clangd.applyEdit';
const executeCommand = 'glist.clangd.executeCommand';
const methodNotFound = -32601;

const { CompletionItemKind: Kind } = monaco.languages;
// Indexed by the LSP CompletionItemKind value minus one.
const completionKinds = [
  Kind.Text, Kind.Method, Kind.Function, Kind.Constructor, Kind.Field, Kind.Variable, Kind.Class, Kind.Interface,
  Kind.Module, Kind.Property, Kind.Unit, Kind.Value, Kind.Enum, Kind.Keyword, Kind.Snippet, Kind.Color, Kind.File,
  Kind.Reference, Kind.Folder, Kind.EnumMember, Kind.Constant, Kind.Struct, Kind.Event, Kind.Operator,
  Kind.TypeParameter,
];
const { MarkerSeverity } = monaco;
// Indexed by the LSP DiagnosticSeverity value minus one.
const severities = [MarkerSeverity.Error, MarkerSeverity.Warning, MarkerSeverity.Info, MarkerSeverity.Hint];

const toRange = (range: Range): monaco.Range => new monaco.Range(
  range.start.line + 1, range.start.character + 1, range.end.line + 1, range.end.character + 1,
);
const fromRange = (range: monaco.IRange): Range => ({
  start: { line: range.startLineNumber - 1, character: range.startColumn - 1 },
  end: { line: range.endLineNumber - 1, character: range.endColumn - 1 },
});
const fromPosition = (position: monaco.IPosition): Position => ({
  line: position.lineNumber - 1, character: position.column - 1,
});
const parseUri = (uri: string): monaco.Uri => monaco.Uri.parse(uri);
const toTextEdit = (edit: TextEdit): monaco.languages.TextEdit => ({ range: toRange(edit.range), text: edit.newText });

const codeBlock = (text: string, language = ''): string => `\`\`\`${language}\n${text}\n\`\`\``;
const toMarkdown = (content: MarkupContent | MarkedString): monaco.IMarkdownString => {
  if (typeof content === 'string') return { value: content };
  if ('kind' in content) return { value: content.kind === 'markdown' ? content.value : codeBlock(content.value) };
  return { value: codeBlock(content.value, content.language) };
};
const toDocumentation = (content?: string | MarkupContent): string | monaco.IMarkdownString | undefined =>
  (content === undefined || typeof content === 'string' ? content : toMarkdown(content));

const toMarker = (diagnostic: Diagnostic): monaco.editor.IMarkerData => ({
  ...toRange(diagnostic.range),
  severity: severities[(diagnostic.severity ?? 1) - 1],
  message: typeof diagnostic.message === 'string' ? diagnostic.message : diagnostic.message.value,
  source: diagnostic.source,
  code: diagnostic.code === undefined ? undefined : String(diagnostic.code),
  tags: diagnostic.tags,
  relatedInformation: diagnostic.relatedInformation?.map((related) => ({
    resource: parseUri(related.location.uri), message: related.message, ...toRange(related.location.range),
  })),
});
const fromMarker = (marker: monaco.editor.IMarkerData): Diagnostic => ({
  range: fromRange(marker),
  severity: (severities.indexOf(marker.severity) + 1) as Diagnostic['severity'],
  message: marker.message,
  source: marker.source,
  code: typeof marker.code === 'string' ? marker.code : marker.code?.value,
});

const toLocationLinks = (
  result: Location | Location[] | LocationLink[] | null,
): monaco.languages.LocationLink[] => {
  if (!result) return [];
  return (Array.isArray(result) ? result : [result]).map((item) => ('targetUri' in item
    ? {
      uri: parseUri(item.targetUri),
      range: toRange(item.targetRange),
      targetSelectionRange: toRange(item.targetSelectionRange),
      originSelectionRange: item.originSelectionRange && toRange(item.originSelectionRange),
    }
    : { uri: parseUri(item.uri), range: toRange(item.range) }));
};

const toSymbol = (symbol: DocumentSymbol | SymbolInformation): monaco.languages.DocumentSymbol => {
  const range = toRange('location' in symbol ? symbol.location.range : symbol.range);
  return {
    name: symbol.name,
    detail: 'detail' in symbol ? symbol.detail ?? '' : '',
    kind: (symbol.kind - 1) as monaco.languages.SymbolKind,
    tags: [],
    range,
    selectionRange: 'selectionRange' in symbol ? toRange(symbol.selectionRange) : range,
    children: 'children' in symbol ? symbol.children?.map(toSymbol) : undefined,
    containerName: 'containerName' in symbol ? symbol.containerName : undefined,
  };
};

// Speaks LSP to clangd over the glistAPI bridge and feeds Monaco from it.
export class ClangdClient {
  private nextId = 1;
  private readonly pending = new Map<number | string, Pending>();
  // Models the user has open, and the change listeners of those clangd knows about.
  private readonly tracked = new Set<monaco.editor.ITextModel>();
  private readonly documents = new Map<string, monaco.IDisposable>();
  private readonly progress = new Map<number | string, string>();
  private capabilities: ServerCapabilities | null = null;
  private providersRegistered = false;
  // Tells Monaco to ask for semantic tokens again.
  private readonly semanticTokensChanged = new monaco.Emitter<void>();
  private session = 0;
  private rootPath: string | null = null;
  // clangd only looks for a missing compile_commands.json every so often, so
  // the first build that writes one is followed by a restart.
  private restartAfterBuild = false;

  constructor(private readonly host: ClangdHost) {
    window.glistAPI.onClangdMessage((message) => this.receive(message as Message));
    window.glistAPI.onClangdStatus((status) => {
      this.reset();
      if (status.message) host.log(status.message);
    });
    monaco.editor.onWillDisposeModel((model) => this.untrack(model));
    monaco.editor.registerCommand(applyEditCommand, (_accessor, edit: WorkspaceEdit, command?: Command) => {
      void this.applyWorkspaceEdit(edit).then((applied) => { if (applied && command) this.execute(command); });
    });
    monaco.editor.registerCommand(executeCommand, (_accessor, command: Command) => this.execute(command));
  }

  async start(rootPath: string): Promise<void> {
    this.reset();
    this.rootPath = rootPath;
    const session = this.session;
    const status = await window.glistAPI.startClangd();
    if (session !== this.session) return;
    if (status.message) this.host.log(status.message);
    if (!status.running) return;
    this.restartAfterBuild = !status.compileCommands;
    this.host.status('clangd', true);
    const rootUri = pathUri(rootPath).toString();
    let result: InitializeResult;
    try {
      result = await this.request<InitializeResult>('initialize', {
        processId: null,
        clientInfo: { name: 'Glist Studio' },
        rootUri,
        workspaceFolders: [{ uri: rootUri, name: baseName(rootPath) }],
        capabilities: {
          general: { positionEncodings: ['utf-16'] },
          window: { workDoneProgress: true },
          workspace: {
            applyEdit: true, workspaceEdit: { documentChanges: true }, configuration: true,
            semanticTokens: { refreshSupport: true },
          },
          textDocument: {
            synchronization: { didSave: true },
            completion: {
              completionItem: {
                snippetSupport: true, documentationFormat: ['markdown', 'plaintext'], labelDetailsSupport: true,
              },
              contextSupport: true,
              // A clangd extension: completing members after '.' on a pointer, with an edit to '->'.
              editsNearCursor: true,
            },
            hover: { contentFormat: ['markdown', 'plaintext'] },
            signatureHelp: {
              signatureInformation: {
                documentationFormat: ['markdown', 'plaintext'],
                parameterInformation: { labelOffsetSupport: true },
                activeParameterSupport: true,
              },
              contextSupport: true,
            },
            definition: { linkSupport: true },
            declaration: { linkSupport: true },
            references: {},
            documentHighlight: {},
            documentSymbol: { hierarchicalDocumentSymbolSupport: true },
            formatting: {},
            rangeFormatting: {},
            rename: { prepareSupport: true },
            codeAction: {
              codeActionLiteralSupport: {
                codeActionKind: { valueSet: ['', 'quickfix', 'refactor', 'refactor.extract', 'refactor.inline', 'refactor.rewrite', 'source'] },
              },
              isPreferredSupport: true,
            },
            publishDiagnostics: { relatedInformation: true, tagSupport: { valueSet: [1, 2] } },
            semanticTokens: {
              requests: { full: true },
              tokenTypes: [
                'namespace', 'type', 'class', 'enum', 'interface', 'struct', 'typeParameter', 'parameter', 'variable',
                'property', 'enumMember', 'function', 'method', 'macro', 'keyword', 'modifier', 'comment', 'string',
                'number', 'operator', 'concept',
              ],
              tokenModifiers: ['declaration', 'definition', 'readonly', 'static', 'deprecated', 'abstract', 'defaultLibrary'],
              formats: ['relative'],
            },
          },
        },
      });
    } catch (error) {
      if (session === this.session) this.host.log(`clangd: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    if (session !== this.session) return;
    this.capabilities = result.capabilities;
    this.notify('initialized', {});
    this.registerProviders(result.capabilities);
    this.host.status('clangd', false);
    this.host.log(`${result.serverInfo?.version?.replace(/\s*\(.*$/, '') ?? 'clangd'} ${t('clangdRunning')}.`);
    this.tracked.forEach((model) => this.open(model));
    this.semanticTokensChanged.fire();
  }

  // Keeps clangd in step with a model the user has open, until it is disposed.
  track(model: monaco.editor.ITextModel): void {
    if (model.getLanguageId() !== 'cpp') return;
    this.tracked.add(model);
    this.open(model);
  }

  // A build may have written or changed compile_commands.json.
  buildFinished(): void {
    if (this.restartAfterBuild && this.rootPath) { void this.start(this.rootPath); return; }
    const model = [...this.tracked][0];
    if (model) this.saved(model);
  }

  saved(model: monaco.editor.ITextModel): void {
    if (this.documents.has(model.uri.toString())) {
      this.notify('textDocument/didSave', { textDocument: { uri: model.uri.toString() } });
    }
  }

  async switchSourceHeader(model: monaco.editor.ITextModel): Promise<monaco.Uri | null> {
    const uri = model.uri.toString();
    if (!this.documents.has(uri)) return null;
    // A clangd extension whose parameters are the document identifier itself.
    const target = await this.request<string | null>('textDocument/switchSourceHeader', { uri }).catch((): null => null);
    return target ? parseUri(target) : null;
  }

  private open(model: monaco.editor.ITextModel): void {
    const uri = model.uri.toString();
    if (!this.capabilities || this.documents.has(uri)) return;
    this.notify('textDocument/didOpen', {
      textDocument: {
        uri, languageId: model.uri.path.endsWith('.c') ? 'c' : 'cpp', version: model.getVersionId(), text: model.getValue(),
      },
    });
    this.documents.set(uri, model.onDidChangeContent((event) => {
      this.notify('textDocument/didChange', {
        textDocument: { uri, version: model.getVersionId() },
        contentChanges: event.isFlush
          ? [{ text: model.getValue() }]
          : event.changes.map((change) => ({ range: fromRange(change.range), rangeLength: change.rangeLength, text: change.text })),
      });
    }));
  }

  private untrack(model: monaco.editor.ITextModel): void {
    this.tracked.delete(model);
    const uri = model.uri.toString();
    const listener = this.documents.get(uri);
    if (!listener) return;
    listener.dispose();
    this.documents.delete(uri);
    monaco.editor.setModelMarkers(model, owner, []);
    this.notify('textDocument/didClose', { textDocument: { uri } });
  }

  private reset(): void {
    this.session += 1;
    this.capabilities = null;
    this.progress.clear();
    this.pending.forEach((request) => request.reject(new Error('clangd stopped')));
    this.pending.clear();
    this.documents.forEach((listener) => listener.dispose());
    this.documents.clear();
    monaco.editor.getModels().forEach((model) => monaco.editor.setModelMarkers(model, owner, []));
    this.host.status(null, false);
  }

  private send(message: Message): void {
    void window.glistAPI.sendClangd({ jsonrpc: '2.0', ...message });
  }

  private notify(method: string, params: unknown): void {
    this.send({ method, params });
  }

  private request<T>(method: string, params: unknown, token?: monaco.CancellationToken): Promise<T> {
    const id = this.nextId;
    this.nextId += 1;
    const result = new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
    });
    this.send({ id, method, params });
    token?.onCancellationRequested(() => { if (this.pending.has(id)) this.notify('$/cancelRequest', { id }); });
    return result;
  }

  // A request about one tracked document. Failures and cancellations yield null.
  private async query<T>(
    model: monaco.editor.ITextModel, method: string, params: object, token?: monaco.CancellationToken,
  ): Promise<T | null> {
    const uri = model.uri.toString();
    if (!this.documents.has(uri)) return null;
    try {
      return await this.request<T>(method, { textDocument: { uri }, ...params }, token);
    } catch {
      return null;
    }
  }

  private receive(message: Message): void {
    if (message.method === undefined) {
      if (message.id === undefined) return;
      const request = this.pending.get(message.id);
      if (!request) return;
      this.pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result ?? null);
      return;
    }
    if (message.id === undefined) { this.handleNotification(message.method, message.params); return; }
    const { id } = message;
    const session = this.session;
    this.handleRequest(message.method, message.params).then(
      (result) => { if (session === this.session) this.send({ id, result }); },
      (error: { code?: number; message?: string }) => {
        if (session === this.session) this.send({ id, error: { code: error.code ?? -32603, message: error.message ?? String(error) } });
      },
    );
  }

  private async handleRequest(method: string, params: unknown): Promise<unknown> {
    switch (method) {
      case 'workspace/configuration':
        return (params as { items: unknown[] }).items.map((): null => null);
      case 'workspace/applyEdit':
        return { applied: await this.applyWorkspaceEdit((params as { edit: WorkspaceEdit }).edit) };
      case 'workspace/semanticTokens/refresh':
        this.semanticTokensChanged.fire();
        return null;
      case 'window/workDoneProgress/create':
      case 'client/registerCapability':
      case 'client/unregisterCapability':
        return null;
      default:
        throw { code: methodNotFound, message: `Unhandled method ${method}` };
    }
  }

  private handleNotification(method: string, params: unknown): void {
    if (method === 'textDocument/publishDiagnostics') {
      const { uri, diagnostics } = params as PublishDiagnosticsParams;
      const model = monaco.editor.getModel(parseUri(uri));
      if (model && this.documents.has(model.uri.toString())) {
        monaco.editor.setModelMarkers(model, owner, diagnostics.map(toMarker));
      }
    } else if (method === '$/progress') {
      const { token, value } = params as Progress;
      if (value.kind === 'begin') this.progress.set(token, value.title);
      if (value.kind === 'end') {
        this.progress.delete(token);
        if (this.progress.size === 0) this.host.status('clangd', false);
      } else {
        const detail = value.message ?? (value.percentage === undefined ? '' : `${value.percentage}%`);
        this.host.status(`clangd: ${this.progress.get(token) ?? ''} ${detail}`.replace(/\s+/g, ' ').trim(), true);
      }
    } else if (method === 'window/showMessage') {
      this.host.log(`clangd: ${(params as { message: string }).message}`);
    }
  }

  private execute(command: Command): void {
    void this.request('workspace/executeCommand', { command: command.command, arguments: command.arguments })
      .catch((error: Error) => this.host.log(`clangd: ${error.message}`));
  }

  // The text edits of a workspace edit, once every file they touch is open for
  // editing. Null when a file cannot be edited or the edit creates or moves files.
  private async openEdit(edit: WorkspaceEdit): Promise<Array<[monaco.editor.ITextModel, TextEdit[]]> | null> {
    const changes: Array<[string, TextEdit[]]> = Object.entries(edit.changes ?? {});
    for (const change of edit.documentChanges ?? []) {
      if (!('textDocument' in change) || change.edits.some((textEdit) => !('newText' in textEdit))) return null;
      changes.push([change.textDocument.uri, change.edits as TextEdit[]]);
    }
    const models = await Promise.all(changes.map(([uri]) => this.host.openForEdit(parseUri(uri))));
    if (models.some((model) => !model)) return null;
    return changes.map(([, edits], index) => [models[index], edits]);
  }

  private async applyWorkspaceEdit(edit: WorkspaceEdit): Promise<boolean> {
    const changes = await this.openEdit(edit);
    if (!changes) {
      this.host.log(`clangd: ${t('editOutsideProject')}`);
      return false;
    }
    changes.forEach(([model, edits]) => {
      model.pushStackElement();
      model.pushEditOperations([], edits.map(toTextEdit), () => null);
      model.pushStackElement();
    });
    return true;
  }

  // Monaco renders peeks and hover previews only for files it already has a model for.
  private async withModels<T extends { uri: monaco.Uri }>(locations: T[]): Promise<T[]> {
    const uris = new Map(locations.map((location) => [location.uri.toString(), location.uri]));
    await Promise.all([...uris.values()].map((uri) => this.host.loadModel(uri)));
    return locations;
  }

  private registerProviders(capabilities: ServerCapabilities): void {
    if (this.providersRegistered) return;
    this.providersRegistered = true;
    const language = 'cpp';
    const { languages } = monaco;

    languages.registerCompletionItemProvider(language, {
      triggerCharacters: capabilities.completionProvider?.triggerCharacters,
      provideCompletionItems: async (model, position, context, token) => {
        const result = await this.query<CompletionList | CompletionItem[]>(model, 'textDocument/completion', {
          position: fromPosition(position),
          context: { triggerKind: context.triggerKind + 1, triggerCharacter: context.triggerCharacter },
        }, token);
        if (!result) return null;
        const items = Array.isArray(result) ? result : result.items;
        const word = model.getWordUntilPosition(position);
        const wordRange = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
        return {
          incomplete: !Array.isArray(result) && result.isIncomplete,
          suggestions: items.map((item): monaco.languages.CompletionItem => {
            const edit = item.textEdit;
            let range: monaco.IRange | monaco.languages.CompletionItemRanges = wordRange;
            if (edit) range = 'range' in edit ? toRange(edit.range) : { insert: toRange(edit.insert), replace: toRange(edit.replace) };
            // Monaco filters on the text from the start of the edit, which for
            // '.' to '->' includes the '.', so lead the filter text with it.
            const start = monaco.Range.getStartPosition('insert' in range ? range.insert : range);
            const lead = start.column < word.startColumn ? model.getValueInRange({
              startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: position.lineNumber, endColumn: word.startColumn,
            }) : '';
            return {
              label: item.labelDetails
                ? { label: item.label, detail: item.labelDetails.detail, description: item.labelDetails.description }
                : item.label,
              kind: completionKinds[(item.kind ?? 1) - 1],
              detail: item.detail,
              documentation: toDocumentation(item.documentation),
              insertText: edit?.newText ?? item.insertText ?? item.label,
              insertTextRules: item.insertTextFormat === 2
                ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
              range,
              filterText: `${lead}${item.filterText ?? item.label}`,
              sortText: item.sortText,
              preselect: item.preselect,
              commitCharacters: item.commitCharacters,
              additionalTextEdits: item.additionalTextEdits?.map(toTextEdit),
            };
          }),
        };
      },
    });

    const legend = capabilities.semanticTokensProvider?.legend;
    if (legend) {
      languages.registerDocumentSemanticTokensProvider(language, {
        onDidChange: this.semanticTokensChanged.event,
        getLegend: () => ({ tokenTypes: legend.tokenTypes, tokenModifiers: styledModifiers }),
        provideDocumentSemanticTokens: async (model, _lastResultId, token) => {
          const tokens = await this.query<SemanticTokens>(model, 'textDocument/semanticTokens/full', {}, token);
          return tokens && { resultId: tokens.resultId, data: restyleSemanticTokens(tokens.data, legend.tokenModifiers) };
        },
        releaseDocumentSemanticTokens: () => undefined,
      });
    }

    languages.registerHoverProvider(language, {
      provideHover: async (model, position, token) => {
        const hover = await this.query<Hover>(model, 'textDocument/hover', { position: fromPosition(position) }, token);
        if (!hover) return null;
        const contents = Array.isArray(hover.contents) ? hover.contents : [hover.contents];
        return { contents: contents.map(toMarkdown), range: hover.range && toRange(hover.range) };
      },
    });

    if (capabilities.signatureHelpProvider) {
      languages.registerSignatureHelpProvider(language, {
        signatureHelpTriggerCharacters: capabilities.signatureHelpProvider.triggerCharacters,
        signatureHelpRetriggerCharacters: capabilities.signatureHelpProvider.retriggerCharacters,
        provideSignatureHelp: async (model, position, token, context) => {
          const help = await this.query<SignatureHelp>(model, 'textDocument/signatureHelp', {
            position: fromPosition(position),
            context: {
              triggerKind: context.triggerKind,
              triggerCharacter: context.triggerCharacter,
              isRetrigger: context.isRetrigger,
            },
          }, token);
          if (!help || help.signatures.length === 0) return null;
          return {
            value: {
              signatures: help.signatures.map((signature) => ({
                label: signature.label,
                documentation: toDocumentation(signature.documentation),
                parameters: (signature.parameters ?? []).map((parameter) => ({
                  label: parameter.label, documentation: toDocumentation(parameter.documentation),
                })),
                activeParameter: signature.activeParameter ?? undefined,
              })),
              activeSignature: help.activeSignature ?? 0,
              activeParameter: help.activeParameter ?? 0,
            },
            dispose: () => undefined,
          };
        },
      });
    }

    const locations = (method: string) => async (
      model: monaco.editor.ITextModel, position: monaco.Position, token: monaco.CancellationToken,
    ): Promise<monaco.languages.LocationLink[]> => this.withModels(toLocationLinks(
      await this.query<Location | Location[] | LocationLink[]>(model, method, { position: fromPosition(position) }, token),
    ));
    languages.registerDefinitionProvider(language, { provideDefinition: locations('textDocument/definition') });
    languages.registerDeclarationProvider(language, { provideDeclaration: locations('textDocument/declaration') });
    languages.registerReferenceProvider(language, {
      provideReferences: async (model, position, context, token) => this.withModels(toLocationLinks(
        await this.query<Location[]>(model, 'textDocument/references', {
          position: fromPosition(position), context: { includeDeclaration: context.includeDeclaration },
        }, token),
      )),
    });

    languages.registerDocumentHighlightProvider(language, {
      provideDocumentHighlights: async (model, position, token) => {
        const highlights = await this.query<DocumentHighlight[]>(
          model, 'textDocument/documentHighlight', { position: fromPosition(position) }, token,
        );
        return highlights?.map((highlight) => ({
          range: toRange(highlight.range),
          kind: ((highlight.kind ?? 1) - 1) as monaco.languages.DocumentHighlightKind,
        }));
      },
    });

    languages.registerDocumentSymbolProvider(language, {
      provideDocumentSymbols: async (model, token) =>
        (await this.query<Array<DocumentSymbol | SymbolInformation>>(model, 'textDocument/documentSymbol', {}, token))
          ?.map(toSymbol),
    });

    languages.registerDocumentFormattingEditProvider(language, {
      provideDocumentFormattingEdits: async (model, options, token) =>
        (await this.query<TextEdit[]>(model, 'textDocument/formatting', {
          options: { tabSize: options.tabSize, insertSpaces: options.insertSpaces },
        }, token))?.map(toTextEdit),
    });
    languages.registerDocumentRangeFormattingEditProvider(language, {
      provideDocumentRangeFormattingEdits: async (model, range, options, token) =>
        (await this.query<TextEdit[]>(model, 'textDocument/rangeFormatting', {
          range: fromRange(range), options: { tabSize: options.tabSize, insertSpaces: options.insertSpaces },
        }, token))?.map(toTextEdit),
    });

    languages.registerRenameProvider(language, {
      resolveRenameLocation: async (model, position) => {
        if (!this.documents.has(model.uri.toString())) return null;
        const range = await this.request<Range | { range: Range; placeholder: string } | null>('textDocument/prepareRename', {
          textDocument: { uri: model.uri.toString() }, position: fromPosition(position),
        }).catch((error: Error) => error);
        if (!range || range instanceof Error) {
          const rejectReason = range instanceof Error ? range.message : t('renameUnavailable');
          return { range: new monaco.Range(1, 1, 1, 1), text: '', rejectReason };
        }
        const target = toRange('range' in range ? range.range : range);
        return { range: target, text: 'placeholder' in range ? range.placeholder : model.getValueInRange(target) };
      },
      provideRenameEdits: async (model, position, newName, token) => {
        const edit = await this.query<WorkspaceEdit>(model, 'textDocument/rename', {
          position: fromPosition(position), newName,
        }, token);
        const changes = edit && await this.openEdit(edit);
        if (!changes) return { edits: [], rejectReason: t('editOutsideProject') };
        return {
          edits: changes.flatMap(([model, edits]) => edits.map((textEdit): monaco.languages.IWorkspaceTextEdit => ({
            resource: model.uri, textEdit: toTextEdit(textEdit), versionId: undefined,
          }))),
        };
      },
    });

    languages.registerCodeActionProvider(language, {
      provideCodeActions: async (model, range, context, token) => {
        const actions = await this.query<Array<Command | CodeAction>>(model, 'textDocument/codeAction', {
          range: fromRange(range),
          context: {
            diagnostics: context.markers.map(fromMarker),
            only: context.only ? [context.only] : undefined,
            triggerKind: context.trigger,
          },
        }, token);
        return {
          actions: (actions ?? []).map((action): monaco.languages.CodeAction => {
            if (typeof action.command === 'string') {
              return { title: action.title, command: { id: executeCommand, title: action.title, arguments: [action] } };
            }
            const codeAction = action as CodeAction;
            let command: monaco.languages.Command | undefined;
            if (codeAction.edit) command = { id: applyEditCommand, title: codeAction.title, arguments: [codeAction.edit, codeAction.command] };
            else if (codeAction.command) command = { id: executeCommand, title: codeAction.title, arguments: [codeAction.command] };
            return {
              title: codeAction.title,
              kind: codeAction.kind,
              isPreferred: codeAction.isPreferred,
              diagnostics: codeAction.diagnostics?.map(toMarker),
              command,
            };
          }),
          dispose: () => undefined,
        };
      },
    });
  }
}
