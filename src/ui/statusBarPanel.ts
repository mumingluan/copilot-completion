import * as vscode from 'vscode';
import { createServiceIdentifier } from '../di/services';
import { IGhostConfigProvider } from '../config/ghostConfig';
import { INesConfigProvider } from '../config/nesConfig';
import { ILogService } from '../completions/shared/log/logService';
import { IGhostCompletionsCache } from '../completions/ghost/completionsCache';
import { INextEditCache } from '../completions/nes/nextEditCache';
import { isEligibleForInlineCompletion, isSourceDocumentUri, isUnavailableForInlineCompletion } from '../completions/shared/documentEligibility';
import { modelSettingScope } from '../config/modelSettingScope';

export const IStatusBarPanel = createServiceIdentifier<IStatusBarPanel>('IStatusBarPanel');

export interface IStatusBarPanel {
    readonly _serviceBrand: undefined;
    register(): vscode.Disposable;
}

type InlineSuggestOverride = {
    key: 'workspaceFolderLanguageValue' | 'workspaceFolderValue'
        | 'workspaceLanguageValue' | 'workspaceValue'
        | 'globalLanguageValue' | 'globalValue';
    target: vscode.ConfigurationTarget;
    languageOverride: boolean;
};

const inlineSuggestOverrides: readonly InlineSuggestOverride[] = [
    { key: 'workspaceFolderLanguageValue', target: vscode.ConfigurationTarget.WorkspaceFolder, languageOverride: true },
    { key: 'workspaceFolderValue', target: vscode.ConfigurationTarget.WorkspaceFolder, languageOverride: false },
    { key: 'workspaceLanguageValue', target: vscode.ConfigurationTarget.Workspace, languageOverride: true },
    { key: 'workspaceValue', target: vscode.ConfigurationTarget.Workspace, languageOverride: false },
    { key: 'globalLanguageValue', target: vscode.ConfigurationTarget.Global, languageOverride: true },
    { key: 'globalValue', target: vscode.ConfigurationTarget.Global, languageOverride: false },
];

/** An explicit false at a more specific scope can mask a true written elsewhere. */
export function disabledInlineSuggestOverrides(
    inspected: Partial<Record<InlineSuggestOverride['key'], boolean>> | undefined,
): readonly InlineSuggestOverride[] {
    return inlineSuggestOverrides.filter(override => inspected?.[override.key] === false);
}

/** Match the native menu: an unconfigured language changes the `*` fallback. */
export function enabledConfigAfterMenuToggle(
    current: Record<string, boolean> | boolean,
    languageId: string,
    enabled: boolean,
): Record<string, boolean> {
    const result: Record<string, boolean> = typeof current === 'boolean' ? { '*': current } : { ...current };
    if (Object.prototype.hasOwnProperty.call(result, languageId)) result[languageId] = enabled;
    else result['*'] = enabled;
    return result;
}

export class StatusBarPanel implements IStatusBarPanel {
    readonly _serviceBrand: undefined;
    private _statusBarItem: vscode.StatusBarItem;
    private _invalidateGhost?: () => void;
    private _invalidateNes?: () => void;

    setCacheInvalidators(ghost: () => void, nes: () => void): void {
        this._invalidateGhost = ghost;
        this._invalidateNes = nes;
    }

    constructor(
        @IGhostConfigProvider private readonly _ghostConfig: IGhostConfigProvider,
        @INesConfigProvider private readonly _nesConfig: INesConfigProvider,
        @ILogService private readonly _log: ILogService,
        @IGhostCompletionsCache private readonly _ghostCache: IGhostCompletionsCache,
        @INextEditCache private readonly _nesCache: INextEditCache,
    ) {
        this._statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100,
        );
        this._statusBarItem.name = 'CC Completion';
        this._updateStatusBar();
    }

    register(): vscode.Disposable {
        this._statusBarItem.show();
        this._statusBarItem.command = 'cc-completion.togglePanel';

        const commandDisposable = vscode.commands.registerCommand(
            'cc-completion.togglePanel',
            () => this._showQuickPick(),
        );
        const commandDisposables = [
            vscode.commands.registerCommand('cc-completion.toggleLanguage', () => this._toggleLanguage()),
            vscode.commands.registerCommand('cc-completion.openSettings', () =>
                vscode.commands.executeCommand('workbench.action.openSettings', '@ext:young-triangle.copilot-completions')),
            vscode.commands.registerCommand('cc-completion.clearCache', () => {
                this._clearCaches();
            }),
            vscode.commands.registerCommand('cc-completion.trigger', () =>
                vscode.commands.executeCommand('editor.action.inlineSuggest.trigger')),
        ];

        const ghostChange = this._ghostConfig.onDidChangeEnabled(() => this._updateStatusBar());
        const nesChange = this._nesConfig.onDidChangeEnabled(() => this._updateStatusBar());
        const editorChange = vscode.window.onDidChangeActiveTextEditor(() => this._updateStatusBar());
        const configChange = vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('cc-completion.enable')
                || event.affectsConfiguration('cc-completion.exclude')
                || event.affectsConfiguration('cc-completion.ghost.baseUrl')
                || event.affectsConfiguration('cc-completion.nes.baseUrl')
                || event.affectsConfiguration('editor.inlineSuggest.enabled')) {
                this._updateStatusBar();
            }
        });

        return {
            dispose: () => {
                this._statusBarItem.dispose();
                commandDisposable.dispose();
                for (const disposable of commandDisposables) disposable.dispose();
                ghostChange.dispose();
                nesChange.dispose();
                editorChange.dispose();
                configChange.dispose();
            },
        };
    }

    private _updateStatusBar(): void {
        const ghostOn = this._ghostConfig.enabled;
        const nesOn = this._nesConfig.enabled;
        const ncpOn = nesOn && this._nesConfig.nextCursorPredictionEnabled;
        const document = vscode.window.activeTextEditor?.document;
        const editorInlineOn = !document || this._isEditorInlineSuggestEnabled(document);
        if (!editorInlineOn) {
            this._statusBarItem.text = '$(copilot-not-connected) Completions';
            this._statusBarItem.tooltip = 'VS Code inline suggestions are disabled';
            return;
        }
        const languageOn = !document || this._isLanguageEnabled(document);
        if (!languageOn) {
            this._statusBarItem.text = '$(copilot-not-connected) Completions';
            this._statusBarItem.tooltip = `Inline suggestions disabled for ${document?.languageId ?? 'this language'}`;
            return;
        }
        if (document && !isEligibleForInlineCompletion(document)) {
            this._statusBarItem.text = '$(copilot-not-connected) Completions';
            this._statusBarItem.tooltip = isSourceDocumentUri(document.uri)
                ? 'Inline suggestions are excluded for this file. Open Completion Settings to review excluded files.'
                : 'Inline suggestions are unavailable in this editor.';
            return;
        }
        const unconfigured = [
            ghostOn && this._ghostConfig.endpointConfigured === false && 'ghost.baseUrl',
            nesOn && this._nesConfig.endpointConfigured === false && 'nes.baseUrl',
        ].filter((value): value is string => typeof value === 'string');
        if (unconfigured.length > 0) {
            this._statusBarItem.text = '$(copilot-warning) Completions';
            this._statusBarItem.tooltip = `Configure ${unconfigured.join(' and ')} to enable completion requests`;
            return;
        }
        const active = [ghostOn && 'G', nesOn && 'N', ncpOn && 'C'].filter(Boolean).join('/');
        if (active) {
            this._statusBarItem.text = '$(copilot) Completions';
            this._statusBarItem.tooltip = [
                ` ${ghostOn ? '✅' : '❌'} Ghost Inline Suggestion `,
                ` ${nesOn ? '✅' : '❌'} Next Edit Suggestion `,
                ` ${ncpOn ? '✅' : '❌'} Next Cursor Prediction `,
            ].join('\n');
        } else {
            this._statusBarItem.text = '$(copilot-blocked) Completions';
            this._statusBarItem.tooltip = 'CC Completion disabled';
        }
    }

    private async _showQuickPick(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        const languageEnabled = editor ? this._isLanguageEnabled(editor.document) : true;
        const editorInlineOn = editor ? this._isEditorInlineSuggestEnabled(editor.document) : true;
        const language = editor?.document.languageId ?? 'current file';
        const enabledConfig = editor
            ? vscode.workspace.getConfiguration('cc-completion', editor.document.uri)
                .get<Record<string, boolean> | boolean>('enable', { '*': true })
            : { '*': true };
        const hasLanguageOverride = typeof enabledConfig !== 'boolean'
            && Object.prototype.hasOwnProperty.call(enabledConfig, language);
        const fileUnavailable = !!editor && isUnavailableForInlineCompletion(editor.document);
        const sourceEditor = !!editor && isSourceDocumentUri(editor.document.uri);
        const suggestionsEnabled = languageEnabled && editorInlineOn && !fileUnavailable && (this._ghostConfig.enabled || this._nesConfig.enabled);
        const needsSetup = (this._ghostConfig.enabled && this._ghostConfig.endpointConfigured === false)
            || (this._nesConfig.enabled && this._nesConfig.endpointConfigured === false);
        const statusText = !editorInlineOn || !languageEnabled || fileUnavailable || !suggestionsEnabled
            ? 'Disabled'
            : needsSetup ? 'Setup required' : 'Ready';
        const status: vscode.QuickPickItem = {
            label: `${this._statusBarItem.text.split(' ')[0]} Status: ${statusText}`,
            description: 'Open Logs',
        };
        const separator = (): vscode.QuickPickItem => ({ label: '', kind: vscode.QuickPickItemKind.Separator });
        const toggleLanguage: vscode.QuickPickItem = {
            label: suggestionsEnabled ? '$(circle-slash) Disable Inline Suggestions' : '$(check) Enable Inline Suggestions',
            description: editor ? (hasLanguageOverride ? `For ${language}` : 'For languages without overrides') : 'No active editor',
        };
        const unavailableFile: vscode.QuickPickItem = {
            label: sourceEditor
                ? '$(settings-gear) Review Excluded Files'
                : '$(circle-slash) Inline Suggestions Unavailable Here',
            description: sourceEditor
                ? 'Open Completion Settings'
                : 'This editor does not support inline suggestions',
        };
        const toggleGhost: vscode.QuickPickItem = {
            label: this._ghostConfig.enabled ? '$(circle-slash) Disable GHOST' : '$(check) Enable GHOST',
        };
        const toggleNes: vscode.QuickPickItem = {
            label: this._nesConfig.enabled ? '$(circle-slash) Disable NES' : '$(check) Enable NES',
        };
        const toggleNcp: vscode.QuickPickItem = {
            label: this._nesConfig.nextCursorPredictionEnabled ? '$(circle-slash) Disable Next Cursor Prediction' : '$(check) Enable Next Cursor Prediction',
            description: this._nesConfig.enabled ? undefined : 'Enable NES first',
        };
        const changeModel: vscode.QuickPickItem = {
            label: '$(symbol-color) Change Completion Models...',
            description: `Inline: ${this._ghostConfig.model} · Next edit: ${this._nesConfig.model}`,
        };
        const configureEndpoints: vscode.QuickPickItem = {
            label: '$(settings-gear) Configure Completion Endpoints...',
            description: 'Set the API base URL for enabled completion models',
        };
        const clearCache: vscode.QuickPickItem = { label: '$(clear-all) Clear Completion Cache' };
        const trigger: vscode.QuickPickItem = { label: '$(play) Trigger Inline Completion' };
        const keyboard: vscode.QuickPickItem = { label: '$(keyboard) Edit Keyboard Shortcuts...' };
        const settings: vscode.QuickPickItem = { label: '$(settings-gear) Open Completion Settings' };
        const logs: vscode.QuickPickItem = { label: '$(output) Open Logs...' };
        const picks = await vscode.window.showQuickPick(
            [status, separator(), ...(editor ? [fileUnavailable ? unavailableFile : toggleLanguage] : []),
                toggleGhost, toggleNes, ...(this._nesConfig.enabled ? [toggleNcp] : []), separator(),
                ...(needsSetup ? [configureEndpoints] : []), changeModel, trigger, clearCache, separator(), keyboard, settings, logs],
            { placeHolder: 'Select an option', title: 'Configure Inline Suggestions' },
        );
        if (!picks) return;
        if (picks === unavailableFile) {
            if (sourceEditor) {
                await vscode.commands.executeCommand('cc-completion.openSettings');
            }
        } else if (picks === toggleLanguage) {
            if (suggestionsEnabled) {
                await this._setMenuInlineSuggestionsEnabled(false);
            } else {
                await this._enableEditorInlineSuggestions();
                await this._setMenuInlineSuggestionsEnabled(true);
                if (!this._ghostConfig.enabled && !this._nesConfig.enabled) this._ghostConfig.enabled = true;
            }
        } else if (picks === toggleGhost) this._ghostConfig.enabled = !this._ghostConfig.enabled;
        else if (picks === toggleNes) this._nesConfig.enabled = !this._nesConfig.enabled;
        else if (picks === toggleNcp && this._nesConfig.enabled) this._nesConfig.nextCursorPredictionEnabled = !this._nesConfig.nextCursorPredictionEnabled;
        else if (picks === changeModel) await this._showModelPicker();
        else if (picks === configureEndpoints) {
            await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:young-triangle.copilot-completions baseUrl');
        }
        else if (picks === clearCache) {
            this._clearCaches();
        } else if (picks === trigger) {
            await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
        } else if (picks === settings) {
            await vscode.commands.executeCommand('cc-completion.openSettings');
        } else if (picks === keyboard) {
            await vscode.commands.executeCommand('workbench.action.openGlobalKeybindings', 'cc-completion');
        } else if (picks === logs || picks === status) {
            this._log.show();
        }
        this._updateStatusBar();
    }

    private async _showModelPicker(): Promise<void> {
        const inline: vscode.QuickPickItem = {
            label: '$(sparkle) Inline Completions',
            description: this._ghostConfig.model,
        };
        const nextEdit: vscode.QuickPickItem = {
            label: '$(edit) Next Edit and Cursor Prediction',
            description: this._nesConfig.model,
        };
        const selected = await vscode.window.showQuickPick([inline, nextEdit], {
            title: 'Change Completion Models',
            placeHolder: 'Choose which model to change',
        });
        if (!selected) return;
        await this._editModel(selected === inline ? 'ghost' : 'nes');
    }

    private async _editModel(kind: 'ghost' | 'nes'): Promise<void> {
        const currentModel = kind === 'ghost' ? this._ghostConfig.model : this._nesConfig.model;
        const newModel = await vscode.window.showInputBox({
            title: kind === 'ghost' ? 'Inline Completion Model' : 'Next Edit Model',
            prompt: 'Enter the model ID accepted by the configured endpoint',
            value: currentModel,
            validateInput: value => value.trim() ? undefined : 'Enter a model ID',
        });
        const normalized = newModel?.trim();
        if (!normalized || normalized === currentModel) return;
        try {
            await this._updateModel(kind, normalized);
        } catch (error) {
            this._log.error(`Failed to change completion model: ${error}`);
            await vscode.window.showErrorMessage('Could not change the completion model. Check your workspace settings.');
        }
    }

    private async _updateModel(kind: 'ghost' | 'nes', model: string): Promise<void> {
        const config = vscode.workspace.getConfiguration(kind === 'ghost' ? 'cc-completion.ghost' : 'cc-completion.nes');
        const target = modelSettingScope(config.inspect<string>('model'));
        await config.update('model', model, target);
        if (kind === 'ghost') {
            this._invalidateGhost?.();
            this._ghostCache.clear();
        } else {
            this._invalidateNes?.();
            this._nesCache.clearAll();
        }
    }

    private _clearCaches(): void {
        this._invalidateGhost?.();
        this._invalidateNes?.();
        this._ghostCache.clear();
        this._nesCache.clearAll();
        this._log.info('Completion caches and pending requests cleared');
    }

    private _isLanguageEnabled(document: vscode.TextDocument): boolean {
        const configured = vscode.workspace.getConfiguration('cc-completion', document.uri)
            .get<Record<string, boolean> | boolean>('enable', { '*': true });
        return typeof configured === 'boolean'
            ? configured
            : (configured[document.languageId] ?? configured['*'] ?? true);
    }

    private _isEditorInlineSuggestEnabled(document: vscode.TextDocument): boolean {
        return vscode.workspace.getConfiguration('editor.inlineSuggest', { uri: document.uri, languageId: document.languageId }).get<boolean>('enabled', true) !== false;
    }

    private async _enableEditorInlineSuggestions(): Promise<void> {
        const document = vscode.window.activeTextEditor?.document;
        if (!document) return;
        const config = vscode.workspace.getConfiguration('editor.inlineSuggest', { uri: document.uri, languageId: document.languageId });
        const inspected = config.inspect<boolean>('enabled');
        for (const override of disabledInlineSuggestOverrides(inspected)) {
            if (this._isEditorInlineSuggestEnabled(document)) break;
            await config.update('enabled', true, override.target, override.languageOverride);
        }
        if (!this._isEditorInlineSuggestEnabled(document)) {
            await config.update('enabled', true, vscode.ConfigurationTarget.Global);
        }
    }

    private async _toggleLanguage(): Promise<void> {
        const document = vscode.window.activeTextEditor?.document;
        if (!document) return;
        await this._setLanguageEnabled(!this._isLanguageEnabled(document));
    }

    private async _setMenuInlineSuggestionsEnabled(enabled: boolean): Promise<void> {
        const document = vscode.window.activeTextEditor?.document;
        if (!document) return;
        const config = vscode.workspace.getConfiguration('cc-completion', document.uri);
        const current = config.get<Record<string, boolean> | boolean>('enable', { '*': true });
        await this._writeEnabledConfig(enabledConfigAfterMenuToggle(current, document.languageId, enabled), config);
    }

    private async _setLanguageEnabled(enabled: boolean): Promise<void> {
        const document = vscode.window.activeTextEditor?.document;
        if (!document) return;
        const config = vscode.workspace.getConfiguration('cc-completion', document.uri);
        const current = config.get<Record<string, boolean> | boolean>('enable', { '*': true });
        const currentObject: Record<string, boolean> = typeof current === 'boolean' ? { '*': current } : { ...current };
        currentObject[document.languageId] = enabled;
        await this._writeEnabledConfig(currentObject, config);
    }

    private async _writeEnabledConfig(currentObject: Record<string, boolean>, config: vscode.WorkspaceConfiguration): Promise<void> {
        const document = vscode.window.activeTextEditor?.document;
        if (!document) return;
        const inspected = config.inspect<Record<string, boolean> | boolean>('enable');
        const target = inspected?.workspaceFolderValue !== undefined
            ? vscode.ConfigurationTarget.WorkspaceFolder
            : inspected?.workspaceValue !== undefined
                ? vscode.ConfigurationTarget.Workspace
                : vscode.ConfigurationTarget.Global;
        await config.update('enable', currentObject, target);
        const effective = currentObject[document.languageId] ?? currentObject['*'] ?? true;
        this._log.info(`Inline suggestions for ${document.languageId}: ${effective ? 'enabled' : 'disabled'}`);
    }
}
